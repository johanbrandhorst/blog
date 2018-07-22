---
title: "gRPC Client Authentication"
date: 2018-07-22
subtitle: "A crash course in different auth methods"
tags: ["go", "gRPC", "authentication", "jwt", "tls"]
---

# Introduction

Best practices for performing client authentication with gRPC
is a question that comes up again and again, so I thought I'd dive
into a few different methods for performing authentication, using
the tools provided by the Go gRPC packages.

Today we'll explore 3 methods of authentication:

1. TLS Client certificate authentication
1. Token Header authenticaiton
1. HTTP Basic authentication

For the TL:DR; check the [example repo](https://github.com/johanbrandhorst/grpc-auth-example).

Note: Go-gRPC interceptors are
[being redesigned](https://github.com/grpc/grpc-go/issues/1805#issuecomment-373525861),
so if you implement this in your server today, you may want to
keep in mind that it will change again in the future.

## TLS Client Certificate Authentication

The first type of authentication uses TLS Certificate subjects
to validate that the correct client is connecting. This, of course,
relies on the issue certificate authority only issuing certificates
with the correct subject to the correct service, but that is outside
the scope of this repository.

On the client side, we create a certificate with the appropriate subject:

```go
pk, err := rsa.GenerateKey(rand.Reader, 2048)
if err != nil {
    return nil, err
}

template := &x509.Certificate{
    SerialNumber: serialNumber,
    Subject: pkix.Name{
        Organization: []string{"Acme Co"},
        CommonName:   username, // Will be checked by the server
    },
    NotBefore:             time.Now(),
    NotAfter:              time.Now().Add(time.Hour),
    KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
    ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
    BasicConstraintsValid: true,
}

cert, err := x509.CreateCertificate(rand.Reader, template, parent.Leaf, pk.Public(), parent.PrivateKey)
if err != nil {
    return nil, err
}

tlsCert := tls.Certificate{
    Certificate: [][]byte{cert},
    PrivateKey:  pk,
}
```

We then use the certificate for transport security when dialing:

```go
tlsConfig := &tls.Config{
    Certificates: []tls.Certificate{tlsCert},
}

conn, err := grpc.DialContext(ctx, net.JoinHostPort(addr, port),
    grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)),
)
```

On the server side, we use the [`grpc/peer`](https://godoc.org/google.golang.org/grpc/peer)
package to find the subject of the client side certificate:

```go
p, ok := peer.FromContext(ctx)
if !ok {
    return status.Error(codes.Unauthenticated, "no peer found")
}

tlsAuth, ok := p.AuthInfo.(credentials.TLSInfo)
if !ok {
    return status.Error(codes.Unauthenticated, "unexpected peer transport credentials")
}

if len(tlsAuth.State.VerifiedChains) == 0 || len(tlsAuth.State.VerifiedChains[0]) == 0 {
    return status.Error(codes.Unauthenticated, "could not verify peer certificate")
}

// Check subject common name against configured username
if tlsAuth.State.VerifiedChains[0][0].Subject.CommonName != a.Username {
    return status.Error(codes.Unauthenticated, "invalid subject common name")
}

return nil
```

This of course requires the server to verify incoming client certs,
so remember to configure the appropriate `tls.Config.ClientAuth` value.
In the example repo, we use `tls.VerifyClientCertIfGiven` to allow clients both
with and without certificates.

## Token based authentication

Secondly we've got token based authentication, which sends the authentication
details in the request headers. On the client side this means implementing
[`grpc/credentials.PerRPCCredentials`](https://godoc.org/google.golang.org/grpc/credentials#PerRPCCredentials).
This example uses a static token, but you could implement some sort of automatic
token renewal based on the existing token in `GetRequestMetadata`.

```go
type tokenAuth struct {
	token string
}

// Return value is mapped to request headers.
func (t tokenAuth) GetRequestMetadata(ctx context.Context, in ...string) (map[string]string, error) {
	return map[string]string{
		"authorization": "Bearer " + t.token,
	}, nil
}

func (tokenAuth) RequireTransportSecurity() bool {
	return true
}
```

We then use the `tokenAuth` struct when dialling:

```go
conn, err := grpc.DialContext(ctx, net.JoinHostPort(addr, port),
    grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(insecure.CertPool, "")),
    grpc.WithPerRPCCredentials(tokenAuth{
        token: token,
    }),
)
```

On the server side, we simply check the header for the token value, but, of course,
if you were using a real token you might want to parse it and perform some validation as well.

```go
const prefix = "Bearer "
if !strings.HasPrefix(auth, prefix) {
	return ctx, status.Error(codes.Unauthenticated, `missing "Bearer " prefix in "Authorization" header`)
}

if strings.TrimPrefix(auth, prefix) != a.Token {
	return ctx, status.Error(codes.Unauthenticated, "invalid token")
}
```

## HTTP Basic authentication

Much like the token based authentication, this uses `PerRPCCredentials`, with the only
difference being the contents of the header:

```go
type basicAuth struct {
	username string
	password string
}

func (b basicAuth) GetRequestMetadata(ctx context.Context, in ...string) (map[string]string, error) {
	auth := b.username + ":" + b.password
	enc := base64.StdEncoding.EncodeToString([]byte(auth))
	return map[string]string{
		"authorization": "Basic " + enc,
	}, nil
}

func (basicAuth) RequireTransportSecurity() bool {
	return true
}
```

And dialling:

```go
conn, err := grpc.DialContext(ctx, net.JoinHostPort(addr, port),
	grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(insecure.CertPool, "")),
	grpc.WithPerRPCCredentials(basicAuth{
		username: username,
		password: password,
	}),
)
```

The server has to parse the the header:

```go
const prefix = "Basic "
if !strings.HasPrefix(auth, prefix) {
    return ctx, status.Error(codes.Unauthenticated, `missing "Basic " prefix in "Authorization" header`)
}

c, err := base64.StdEncoding.DecodeString(auth[len(prefix):])
if err != nil {
    return ctx, status.Error(codes.Unauthenticated, `invalid base64 in header`)
}

cs := string(c)
s := strings.IndexByte(cs, ':')
if s < 0 {
    return ctx, status.Error(codes.Unauthenticated, `invalid basic auth format`)
}

user, password := cs[:s], cs[s+1:]
if user != a.Username || password != a.Password {
    return ctx, status.Error(codes.Unauthenticated, "invalid user or password")
}
```

## Conclusion

We've seen 3 different methods of authenticating a gRPC client with a
gRPC server. My personal preference is to use TLS client certificate authentication
when possible, but this requires quite a bit of external setup. Check
out [my Certify library](/post/certify/) to make that kind of thing easier.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
