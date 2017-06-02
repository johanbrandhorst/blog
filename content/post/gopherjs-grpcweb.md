---
date: 2017-05-30
subtitle: Introducing the GopherJS gRPC-Web bindings
tags: ["golang", "protobuf", "grpc", "gopherjs"]
title: gRPC-Web in GopherJS
draft: true
---

In a [previous blog series](/post/gopherjs-client-grpc-server/) I've talked about
how to work with a gRPC backend from the GopherJS world. It relies on the
[gRPC-gateway](https://github.com/grpc-ecosystem/grpc-gateway) which is a great
piece of tech, but unfortunately carries a couple of downsides:

1. Clients don't know what types are used - the interface is HTTP JSON.
This can be somewhat mitigated with the use of swagger generated interfaces,
but it's still not perfect.
1. The interface being JSON means marshalling and unmarshalling can become a
significant part of the latency between the client and the server.
1. The gRPC-gateway requires specific changes to the proto
definitions - it's not as straightforward as just defining your RPC methods.

Fortunately, with the release of a spec compliant
[gRPC-Web implementation from Improbable](https://spatialos.improbable.io/games/grpc-web-moving-past-restjson-towards-type-safe-web-apis),
we can finally start enjoying the benefits of a protobuf typed interface in the frontend. This
deals with all the mentioned downsides of the gRPC-gateway;

1. Interfaces are typed via protobuffers.
1. Messages are serialized to binary.
1. There's no difference between exposing the gRPC server to the web client than any other client.

In the last couple of weeks I've been working on a GopherJS wrapper for gRPC-Web,
and I'm pleased to say that it's ready for others to play around with. The wrapper is comprised of
the [`grpcweb`](https://github.com/johanbrandhorst/grpcweb)
GopherJS library, and the
[`protoc-gen-gopherjs`](https://github.com/johanbrandhorst/protoc-gen-gopherjs) protoc plugin.
Together, they make it possible to generate a GopherJS client interface from your proto file definitions. The `proto-gen-gopherjs` README contains a thorough guide
into how to generate the client interfaces.

To give you an idea of the usage, me and Paul Jolly ([@_myitcv](https://twitter.com/_myitcv)) have created an example repo. If you want to skip ahead, the source is available on
[my github](https://github.com/johanbrandhorst/grpcweb-example).
I'm going to assume that if you're reading this post you're already familiar with how to implement the Go backend part of this, so we'll jump right into the client. The only difference
in the backend from a normal Go gRPC server is the use of the
[Improbable gRPC-Web proxy](https://github.com/improbable-eng/grpc-web/tree/master/go/grpcweb).

## The Client

The client is implemented using
[Paul Jolly's React Bindings](https://myitcv.io/react)
and the interface generated using `protoc-gen-gopherjs`.
With the generated file, we have access to the `BookType` enum
and the `Publisher`, `Book`, `GetBookRequest` and
`QueryBooksRequest` structs. More importantly, we get access
to the gRPC-Web methods `GetBook` and `QueryBooks`.

First off we need to create a new client:

```go
client := library.NewBookServiceClient(baseURI)
```

The parameter is the address of the gRPC server, in this case
the same address as we're hosting the JS from, but it could
be located on some external address. Note that gRPC-Web over HTTP2 requires TLS.

Once we have a client, we can make calls on it just like on
a normal Go gRPC client.
All RPC methods are blocking by default, though there are
plans to expose an asynchronous API later on. Lets get
the book with an `ISBN` of `140008381`:

```go
book, err := client.GetBook(context.Background(), library.NewGetBookRequest(140008381))
if err != nil {
    println("Got request error:", err.Error())
    return
}
```

The context parameter can be used to control timeout, deadline and cancellation of requests.

