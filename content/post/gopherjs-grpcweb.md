---
date: 2017-06-20
subtitle: Introducing the GopherJS gRPC-Web bindings
tags: ["golang", "protobuf", "grpc", "grpc-web", "gopherjs", "react"]
title: gRPC-Web with GopherJS
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

The Improbable gRPC-Web README also has
a [long list of benefits](https://github.com/improbable-eng/grpc-web#why).

## gRPC-Web in GopherJS

In the last couple of weeks I've been working on a GopherJS wrapper for gRPC-Web,
and I'm pleased to say that it's ready for others to play around with. The wrapper is comprised of
the [`grpcweb`](https://github.com/johanbrandhorst/protobuf/grpcweb)
GopherJS library and the
[`protoc-gen-gopherjs`](https://github.com/johanbrandhorst/protobuf/protoc-gen-gopherjs) protoc plugin.
Together, they make it possible to generate a GopherJS client
interface from your proto file definitions. The
[`protoc-gen-gopherjs`](https://github.com/johanbrandhorst/protobuf/protoc-gen-gopherjs)
README contains a thorough guide
into how to generate the client interfaces.

To give an idea of the usage, I've put together an example
using the [GopherJS React bindings](https://myitcv.io/react)
created by Paul Jolly ([@_myitcv](https://twitter.com/_myitcv)).
If you want to skip ahead, the source is available on
[my github](https://github.com/johanbrandhorst/grpcweb-example), and a live
example can be found on
[my demo site](https://grpcweb.jbrandhorst.com).

I'm going to assume that if you're reading this post you're already familiar with how to implement the Go backend part of this, so we'll jump right into the client. The only difference
in the backend from a normal Go gRPC server is the use of the
[Improbable gRPC-Web proxy](https://github.com/improbable-eng/grpc-web/tree/master/go/grpcweb)
wrapper. This is necessary as a translation layer from the
gRPC-Web requests to fully compliant gRPC requests. There
also exists a
[general-purpose proxy server](https://github.com/improbable-eng/grpc-web/tree/master/go/grpcwebproxy),
which can be used with gRPC servers in other languages.

## The Client

The interface is generated using `protoc-gen-gopherjs`.
The source protofile can be found
[in the repo](https://github.com/johanbrandhorst/grpcweb-example/blob/master/proto/library/book_service.proto).
With the generated file we get access to the gRPC-Web
methods `GetBook` and `QueryBooks`.

First off we need to create a new client:

```go
client := library.NewBookServiceClient(baseURI)
```

The parameter is the address of the gRPC server, in this case
the same address as we're hosting the JS from, but it could
be located on some external address. Note that gRPC-Web over HTTP2 requires TLS.

## A simple request

Once we have a client, we can make calls on it just like on
a normal Go gRPC client. The generated interfaces are
designed to be as similar as possible to `protoc-gen-go`
client interfaces.
All RPC methods are blocking by default, though there are
plans to expose an asynchronous API later on, if there
is demand for it.

Lets get the book with an `ISBN` of `140008381`:

```go
req := &library.GetBookRequest{
    Isbn: 140008381,
}
book, err := client.GetBook(context.Background(), req)
if err != nil {
    panic(status.FromErr(err))
}
println(book)
```

The context parameter can be used to control timeout,
deadline and cancellation of requests. The second parameter
is the request to the method. Looks just like the normal Go client API.

## Server side streaming

It wouldn't be gRPC without streaming. Unfortunately,
gRPC-Web does not currently support _client_-side streaming.
We do have access to server side streaming though. This is
a simple example of how to consume message from a streaming
server side method:

```go
req := &library.QueryBooksRequest{
    AuthorPrefix: "George",
}
srv, err := client.QueryBooks(context.Background(), req)
if err != nil {
    panic(status.FromErr(err))
}

for {
    // Blocks until new book is received
    bk, err := srv.Recv()
    if err != nil {
        if err == io.EOF {
            // Success! End of stream.
            return
        }
        panic(status.FromErr(err))
    }
    println(bk)
}
```

Much like the Go client API, we get a streaming server
which we call `Recv` on until we see an error. If the
error is `io.EOF`, it means the server has closed the stream
successfully.

## Wrapping up
With the release of an unofficial gRPC-Web client by Improbable,
the frontend can finally start getting some of the benefits
the backend has enjoyed for a couple of years now,
courtesy of gRPC and Protobuffers. I'm personally extremely
excited by the opportunities it affords frontend developers
working with a simple frontend layer talking to a backend service. Navigate to
[my demo site](https://grpcweb.jbrandhorst.com)
for an example of how to develop gRPC-Web applications
with GopherJS, and take a look at
[the github repo](https://github.com/johanbrandhorst/grpcweb-example)
afterwards.

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!
