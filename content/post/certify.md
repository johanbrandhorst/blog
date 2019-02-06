---
date: 2018-03-25
subtitle: "Introducing Certify, a purpose built library"
tags: ["golang", "tls", "certificate", "vault"]
title: Automatic TLS certificate distribution with Vault
---

It's often recommended that microservice communications are encrypted,
especially if they cross the public internet. Even when you control
the network, whether virtually or physically, encrypting traffic
can still be valuable. [Lets Encrypt](https://letsencrypt.org/) has
revolutionized the distribution of certificates for publically
facing servers; unfortunately, encrypting internal traffic
often involves complicated certificate generation setups.

[Hashicorp Vault](https://www.vaultproject.io/) is a project for storing
secrets and performing authentication. It has a
[PKI Secret Engine backend](https://www.vaultproject.io/docs/secrets/pki/index.html)
which allows you to use it as a certificate authority in an internal
public key infrastructure deployment. It solves a lot of problems
associated with internal certificate distribution, but it still
requires either manual distribution steps or some third-party
application for ensuring certificates are re-issued when necessary.

To solve this problem, I've written a library that makes this all much easier.

## Introducing Certify

[![Certify](/img/certify.png "Certify")](https://github.com/johanbrandhorst/certify)

I've created [Certify](https://github.com/johanbrandhorst/certify) to allow easy and safe communications between servers
and clients and services.

Certify hooks into the [`tls.Config`](https://golang.org/pkg/crypto/tls/#Config)
`GetCertificate` and `GetClientCertificate` methods to perform certificate
distribution and renewal whenever it's needed, automatically. It will cache
certificates that are still valid (if configured), and re-issue certificates
that approach their expiry. It deduplicates simultaneous requests to avoid
overloading issuers.

The library has implemented issuers for the following 3 private certificate
authority servers:

- [Vault PKI Secrets Engine](https://vaultproject.io)
- [Cloudflare CFSSL Certificate Authority](https://cfssl.org/)
- [AWS Certificate Manager Private Certificate Authority](https://aws.amazon.com/certificate-manager/private-certificate-authority/)

Lets look at a simple example of using the Vault secrets backend:

```go
cb := certify.Certify{
    Issuer: &vault.Issuer{
        VaultURL: &url.URL{
            Scheme: "https",
            Host: "my-vault-instance.com",
        },
        Role: "myVaultRole",
        Token: "myVaultToken",
    },
    // CommonName is the value used to configure
    // the common name of the certificates.
    CommonName: "MyBackendServer",
    // It is recommended to use a cache.
    Cache: certify.NewMemCache(),
    // It is recommended to set a RenewThreshold.
    // Refresh cached certificates when < 24H left before expiry.
    RenewThreshold: 24*time.Hour,
}

srv := http.Server{
    TLSConfig: &tls.Config{
        GetCertificate: cb.GetCertificate,
    },
}

_ = srv.ListenAndServe()
```

This sets up the server with automatic certificate issuing
and renewal. Certificates use the configured common name,
and will have its SAN or IPSAN field set to the IP or DNS
that was used _to connect to the server_. This means, as long
as the Vault role is configured to allow a specific IP or DNS,
and that IP or DNS is used to connect to a certify configured
server, certify will request a certificate for that DNS or IP
to be issued, and then stored in the cache for future use.

## Mutual TLS with gRPC

The certify tests include an example of using certify
for [mutual TLS with gRPC](https://github.com/johanbrandhorst/certify/blob/5def22fb72640efe80dacb27b57929411248af8e/issuers/vault/vault_test.go#L158).

See the [presentations page](/page/presentations#certify) for a video
introducing Certify.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
