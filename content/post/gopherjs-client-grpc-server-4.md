+++
date = "2017-04-14"
title = "GopherJS Client and gRPC Server - Part 4"
subtitle ="A guide to implementing a GopherJS frontend to a gRPC backend exposed over HTTP via the gRPC-gateway"
tags = [ "golang", "protobuf", "grpc", "grpc-gateway", "gopherjs" ]
+++
## Putting it all together

As we touched upon earlier, we generate a package from the generated JS
(meta, right?), which can be served from the server. We'll create a new
file, `main.go`, in which we can spin up a server, serve the frontend
and the gRPC backend.

Much of the logic in this file is inspired by the
[excellent blog post put together by Brandon Philips](https://coreos.com/blog/grpc-protobufs-swagger.html)
over at CoreOS. We're using his elegant solution to serve
both the HTTP API and the gRPC API on the same port.

```go
package main

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Sirupsen/logrus"
	assetfs "github.com/elazarl/go-bindata-assetfs"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/tmc/grpc-websocket-proxy/wsproxy"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/grpclog"

	"github.com/johanbrandhorst/gopherjs-grpc-websocket/client/compiled"
	pserver "github.com/johanbrandhorst/gopherjs-grpc-websocket/protos/server"
	"github.com/johanbrandhorst/gopherjs-grpc-websocket/server"
	"github.com/johanbrandhorst/gopherjs-grpc-websocket/server/insecure"
)

// If you change this, you'll need to change the cert as well
const addr = "localhost:10000"

// Cert and Key should be replaced if you're going to use this
// Copied from
// https://github.com/philips/grpc-gateway-example/blob/0412e3928cb7d47e68b91971a8e79f93d92361ee/insecure/certs.go
const (
	key = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEA2KEH2CLMVmPLGwuExXDUk4TdQInkD0AAe22a1ixKxmRdSXkf
lDKu4cHL0N5ohJBonL/udGWkI6AI51lvJ54zl9SxPoZdWzkdca5H9Cw/7Es3SYyd
eVBkEo341D4hZqpFJM+vPReCQyTCHKGR6XnmN8E9V2RhTKpiagqfSpNmj08Rg3o3
Ap7IzaRRnqmGyKLgJEC2hEXj7nIvHtpm4SCjm2px4bRKQRxREuujOGfqBDh6uYQF
L46PI+QKWDN5J9+fROU9Y0HRFy7JnTkNyTuUxhjB5r2KReQ7cGGpUJzRIyyUDp/u
3+N58AoyQHf/bXpWE0oSfOhwNABVaRWWgxOP2wIDAQABAoIBAEyvtLcummd6rEvG
qBm894PBZRGTvsgnQARxqH5o74+Lt/pqhmNQDdidYiluklFbTa0vxJov4Qs7e+tq
HY9I0brN8HDR3/qLHYFA0Pf/MiHT/p5qyNRJQSPQXmXEGM7fN9rwKnjV+acLPCwm
hiDApl7WaYCmaEtbhbtER19/Dq9sB2vwF2hWvaS8TkpMe6otPVO+3h8MZfrCEQCY
sKpZRJEGaHGX+Oe14NlmO+WhpCR9YXftq5En//zZie5TXiSM596IDriUYf9pWr99
Xeo1JggyrGkQvmGfi5u5qpieX4QBjBKdSqOhiaUKaLQ9T6+mnijp3Cfl/HAkhS5d
RQcmJwECgYEA6+gAvAvPaWxeTY2hiyZfL7trbwJAjrNPxCim6eJJZbhByXnG7oVT
JZQo0pNaE/Exszv0BoaxURKNHM5mU6dEZRgwaiY4UUuKyK2OkSHEu8sOwpXcGI7k
udjEbRaeYBcNAmB25qgisubjbveDJiwK1hbG9T+pSn3E+VotRU2Vk3UCgYEA6xSu
wxSq79llO25O5BQ39DHKfTPeb6KBRdtCIM1L9FQH5CswVQcv1BwqvtvP724cQLkR
5fSQyG5G9qHXmh2dj9pB65h05wlO+F03DP1pQB25QyiogyrWwNmWGnrdsJRo1lAh
pbEWFP+/26n+VtFBcbDcClQsvPL0gOz7hiAuvA8CgYB9SYwKUuNnBAzZd1zSQCDR
guI95J5Qq16zuTtcf7endEJMNIa4asqL7LH5lBSE/tX8cNzbEnHdstKK9/tUdkNW
xZAA8Cd81XfxuGs9HQgVDHTcVya7TDihk0RPA3I9akCYgI7lVWqIRSOI7Z8TiNSA
ezxTR+orC7yvCXt9kQTdeQKBgF2z+dFCzLwcMJDW8FVThdYtfqQXZ8Ohx9ubgSlo
C62RTS/y0yohWjw3GgbHwYOTpWlbG7pImOl7o4etjS4ePe7YNcx+EaMB/9tZ9JaV
8D0hW/ZcH4dhLQbj9EQL05AOKBe9CxxrkPy/0K7zfLEIagiyUZNAaDDMuw8k50FY
VKibAoGAMLZlWDtCHA4J5GhLqRFzOzt2I650EOu/kNhGtJ/8YybgtMVaoN50PGfk
Dr7+TS/DxJzY7h0yNakDg6KZKT4U4qLh74VFaHCnADyQfQnJK+1ffhNhdeoSzp+L
zpDUVEXH6eEeRWmyxoWjWnsquube0gRKf2BQ+yYjk+CUwL/Aqk4=
-----END RSA PRIVATE KEY-----`
	cert = `-----BEGIN CERTIFICATE-----
MIIEBjCCAu6gAwIBAgIJALzaDcEdLBD7MA0GCSqGSIb3DQEBBQUAMF8xCzAJBgNV
BAYTAkFVMRMwEQYDVQQIEwpTb21lLVN0YXRlMSEwHwYDVQQKExhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQxGDAWBgNVBAMTD2xvY2FsaG9zdDoxMDAwMDAeFw0xNjAy
MTgwMzU5NDJaFw0yNjAyMTUwMzU5NDJaMF8xCzAJBgNVBAYTAkFVMRMwEQYDVQQI
EwpTb21lLVN0YXRlMSEwHwYDVQQKExhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQx
GDAWBgNVBAMTD2xvY2FsaG9zdDoxMDAwMDCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBANihB9gizFZjyxsLhMVw1JOE3UCJ5A9AAHttmtYsSsZkXUl5H5Qy
ruHBy9DeaISQaJy/7nRlpCOgCOdZbyeeM5fUsT6GXVs5HXGuR/QsP+xLN0mMnXlQ
ZBKN+NQ+IWaqRSTPrz0XgkMkwhyhkel55jfBPVdkYUyqYmoKn0qTZo9PEYN6NwKe
yM2kUZ6phsii4CRAtoRF4+5yLx7aZuEgo5tqceG0SkEcURLrozhn6gQ4ermEBS+O
jyPkClgzeSffn0TlPWNB0RcuyZ05Dck7lMYYwea9ikXkO3BhqVCc0SMslA6f7t/j
efAKMkB3/216VhNKEnzocDQAVWkVloMTj9sCAwEAAaOBxDCBwTAdBgNVHQ4EFgQU
7JqKxmk2/4aClcix32bvTr0MUkQwgZEGA1UdIwSBiTCBhoAU7JqKxmk2/4aClcix
32bvTr0MUkShY6RhMF8xCzAJBgNVBAYTAkFVMRMwEQYDVQQIEwpTb21lLVN0YXRl
MSEwHwYDVQQKExhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQxGDAWBgNVBAMTD2xv
Y2FsaG9zdDoxMDAwMIIJALzaDcEdLBD7MAwGA1UdEwQFMAMBAf8wDQYJKoZIhvcN
AQEFBQADggEBAGo0MdEPAV6EH2mhIXBJb6qjg7X0kGqmh10UzmNc/r4N0lcfoPc3
q91N3tAk2zxASW16FPumd3eRtn5FdEWLTK2SAJkP24g6199pUbcEvzHas5/awRI3
PFwNJ+cqsYkXxsW09/cvRBFqMqrkavvoMfCwQhMJwGnql+BeN4mBS00JglHWSfDT
e8T2yhkPc0+FuAH4ZfmdZUb+yPAv+liT+lCw+vUEsN8mnam8lZKCzhROVfmgKEHM
Ze0aj9tzK3Su1tjAEzN4arrajCopkJA2aDI2i8EZ+2Zx1qbhNXwJd3E9MYs9WmLf
RX7r0aSW3Y9r+/SmjYJLXB36CwbcjLHmQN0=
-----END CERTIFICATE-----`
)

var (
	KeyPair  *tls.Certificate
	CertPool *x509.CertPool
	logger *logrus.Logger
)

func init() {
	var err error
	pair, err := tls.X509KeyPair([]byte(cert), []byte(key))
	if err != nil {
		panic(err)
	}
	KeyPair = &pair
	CertPool = x509.NewCertPool()
	ok := CertPool.AppendCertsFromPEM([]byte(cert))
	if !ok {
		panic("bad certs")
	}
	logger = logrus.StandardLogger()
	logrus.SetLevel(logrus.InfoLevel)
	logrus.SetFormatter(&logrus.TextFormatter{
		ForceColors:     true,
		FullTimestamp:   true,
		TimestampFormat: time.Kitchen,
		DisableSorting:  true,
	})
	grpclog.SetLogger(logger)
}

func main() {
	s := &server.Server{}

	gs := grpc.NewServer(grpc.Creds(credentials.NewServerTLSFromCert(KeyPair)))
	pserver.RegisterMyServerServer(gs, s)
	conn, err := net.Listen("tcp", addr)
	if err != nil {
		logger.WithError(err).Fatal("Failed to start listener")
	}

	// Create a context for easy cancellation
	ctx, cancelFunc := context.WithCancel(context.Background())
	defer cancelFunc()

	// Gracefully shut down on ctrl-c
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-c
		go cancelFunc()
		go gs.GracefulStop()
		go conn.Close()
	}()

	mux := http.NewServeMux()

	// Serve the gopherjs client
	mux.Handle("/", http.FileServer(&assetfs.AssetFS{
		Asset:     compiled.Asset,
		AssetDir:  compiled.AssetDir,
		AssetInfo: compiled.AssetInfo,
	}))

	gwMux := runtime.NewServeMux(
		runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
			EmitDefaults: true,
			OrigName:     true,
		}),
	)
	// Wrap the gateway in the websocket proxy for bidi streams!
	mux.Handle("/api/", wsproxy.WebsocketProxy(gwMux))

	dcreds := credentials.NewTLS(&tls.Config{
		ServerName: addr,
		RootCAs:    CertPool,
	})
	dopts := []grpc.DialOption{grpc.WithTransportCredentials(dcreds)}
	err = pserver.RegisterMyServerHandlerFromEndpoint(ctx, gwMux, addr, dopts)
	if err != nil {
		logger.WithError(err).Fatal("Failed to dial server")
	}

	srv := &http.Server{
		Addr:    addr,
		Handler: grpcHandlerFunc(gs, mux),
		TLSConfig: &tls.Config{
			NextProtos:   []string{"h2"},
			Certificates: []tls.Certificate{*KeyPair},
		},
	}

	logger.Warn("Serving on ", addr)
	logger.Fatal(srv.Serve(tls.NewListener(conn, srv.TLSConfig)))
}

// GrpcHandlerFunc returns an http.Handler that delegates to grpcServer on incoming gRPC
// connections or otherHandler otherwise. Copied from cockroachdb.
func grpcHandlerFunc(grpcServer http.Handler, otherHandler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This is a partial recreation of gRPC's internal checks https://github.com/grpc/grpc-go/pull/514/files#diff-95e9a25b738459a2d3030e1e6fa2a718R61
		if r.ProtoMajor == 2 && strings.Contains(r.Header.Get("Content-Type"), "application/grpc") {
			grpcServer.ServeHTTP(w, r)
		} else {
			otherHandler.ServeHTTP(w, r)
		}
	})
}
```

Most of this is basic boilerplate when setting up a Go gRPC server, but there's a couple of
things I want to draw attention to.

```go
// Serve the gopherjs client
mux.Handle("/", http.FileServer(&assetfs.AssetFS{
	Asset:     compiled.Asset,
	AssetDir:  compiled.AssetDir,
	AssetInfo: compiled.AssetInfo,
}))
```

This is the magic that serves the GopherJS generated JS (and the `HTML`). Thanks to
`go-bindata` we can just import the package and register it as a file server.

```go
gwMux := runtime.NewServeMux(
	runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
		EmitDefaults: true,
		OrigName:     true,
	}),
)
```

This creates a new `gRPC-gateway` mux, but with a custom JSON marshaler which always
marshals all values of the struct into the `JSON`. This is not default behaviour, because
it means the client (frontend) can't tell the difference between when a value was not set
and when it was set to the zero value of that type. We add it because I think it's mostly
expected of real REST APIs to always return all fields.

```go
// Wrap the gateway in the websocket proxy for bidi streams!
mux.Handle("/api/", wsproxy.WebsocketProxy(gwMux))
```

This magic is what makes it possible for our `grpc-gateway` to handle bidi streams
through websockets, thanks to the work of [tmc](https://github.com/tmc) and his library
[grpc-websocket-proxy](https://github.com/tmc/grpc-websocket-proxy). It's a lovely
little wrapper and I encourage you to take a look at it to understand how it works.

```go
// GrpcHandlerFunc returns an http.Handler that delegates to grpcServer on incoming gRPC
// connections or otherHandler otherwise. Copied from cockroachdb.
func grpcHandlerFunc(grpcServer http.Handler, otherHandler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This is a partial recreation of gRPC's internal checks https://github.com/grpc/grpc-go/pull/514/files#diff-95e9a25b738459a2d3030e1e6fa2a718R61
		if r.ProtoMajor == 2 && strings.Contains(r.Header.Get("Content-Type"), "application/grpc") {
			grpcServer.ServeHTTP(w, r)
		} else {
			otherHandler.ServeHTTP(w, r)
		}
	})
}
```

This is what allows us to serve the gRPC and HTTP API on the same port. A simple
handler for splitting the gRPC requests from the rest. Pretty cool!

Now with all the puzzle pieces together we should be able to just generate the JS once
and run the server!

```bash
$ go generate ./client/...
$ go run main.go
WARN[7:31PM] Serving on https://localhost:10000
```

Now hopefully if we navigate to https://localhost:10000 in
a browser we'll be greeted by our website. And that's it!

## Final thoughts
`GopherJS` is cool, `gRPC` is great, the `gRPC-gateway` is awesome, and
the `grpc-websocket-proxy` is amazing. With these tools put together
we've shown that it's possible to use all the features of modern
browsers while still writing Go. I'm going to continue playing around
with `GopherJS` and undoubtedly continue to use `gRPC` at work.

Again, to see the whole example in one place, please check out
[my github](https://github.com/johanbrandhorst/gopherjs-grpc-websocket).

I hope you've enjoyed reading this, and if you have any feedback or questions,
please contact me on gophers slack or via [my twitter](https://twitter.com/JohanBrandhorst).
