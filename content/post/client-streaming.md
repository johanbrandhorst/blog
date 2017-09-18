---
date: 2017-09-17
subtitle: "Enhancing the GopherJS gRPC-Web bindings with Websockets"
tags: ["golang", "gopherjs", "websockets", "grpc-web", "grpc"]
title: Client side streaming in gRPC-Web
---

In a [previous post](../gopherjs-grpcweb) I introduced my open source project
to bring GopherJS bindings to Improbable's gRPC-Web client. I'm happy to say
that the initial goal of supporting all features of the gRPC-Web client has been
completed. I was initially going to leave it at that and wait for client side
streaming to land in the [WHATWG Streams API Standard](https://streams.spec.whatwg.org/),
and subsequently added to the official grpc-web spec and probably the gRPC-Web client,
but then I was sitting at the GolangUK conference and I had a brain wave. What if I could
write a Websocket proxy, à la Travis Clines [grpc-websocket-proxy](https://github.com/tmc/grpc-websocket-proxy)
but translate the Websocket messages to gRPC streaming messages?

I immediately started prototyping it with my grpcweb-example repo and a custom websocket proxy.
I experimented with a few different ways of translating Websocket messages to HTTP2 framed messages
according to the [gRPC wire format spec](https://grpc.io/docs/guides/wire.html), but in the end
I reused the `ClientTransport` type from the [gRPC `transport` package](https://google.golang.org/grpc/transport)
which made that part quite simple. I used the [`grpc` package](https://google.golang.org/grpc) for inspiration here.

For reporting the status of RPCs I used the Websocket CloseMessage, which allows you to specify a
message string and a code, which seemed too perfect to pass up on. I translated gRPC codes into the
user defined implementation range of 4000+ in order to send it across the Websocket transport without
upsetting standard compliant clients.

The full source for the Websocket proxy is of course
[on my github](https://github.com/johanbrandhorst/protobuf/blob/master/wsproxy/wsproxy.go).

It was surprisingly easy to get everything up and running, and I'm pretty pleased with how it turned out.
It's not entirely done yet, as it doesn't yet support fetch headers and trailers from the server. I added
a client side streaming and a bidi streaming example to the
[grpcweb-example page](https://grpcweb.jbrandhorst.com) to show off the capabilities.
I'm particularly happy with how the client chat example turned out, both in the frontend and the logic
for distributing the messages in the backend. Here's an excerpt:

```go
// Send join message before user joins
s.b.Broadcast(srv.Context(), name+" has joined the chat")

listener := make(chan string)
err = s.b.Add(name, listener)
if err != nil {
    return err
}
defer func() {
    s.b.Remove(name)
    s.b.Broadcast(context.Background(), name+" has left the chat")
}()
```

Check out the full source
[on my github](https://github.com/johanbrandhorst/grpcweb-example/blob/master/server/server.go#L170).

Adding the proxy to your gRPC server looks a little like this:

```go
gs := grpc.NewServer()
wrappedServer := grpcweb.WrapServer(gs)

var clientCreds credentials.TransportCredentials
if *host == "" {
    var err error
    clientCreds, err = credentials.NewClientTLSFromFile("./insecure/localhost.crt", "localhost:10000")
    if err != nil {
        logger.Fatalln("Failed to get local server client credentials:", err)
    }
} else {
    cp, err := x509.SystemCertPool()
    if err != nil {
        logger.Fatalln("Failed to get local system certpool:", err)
    }
    clientCreds = credentials.NewTLS(&tls.Config{RootCAs: cp})
}

wsproxy := wsproxy.WrapServer(
    http.HandlerFunc(wrappedServer.ServeHTTP),
    wsproxy.WithLogger(logger),
    wsproxy.WithTransportCredentials(clientCreds))
```

Cribbed straight from my [grpcweb-example repo](https://github.com/johanbrandhorst/grpcweb-example/blob/master/main.go).
This nicely shows how to work with both local certificates and with on signed by a trusted CA. Also note the use of
the Improbable `grpcweb.WrapServer` in order to support gRPC-Web as well.

So to conclude, we now have support for client side and bidirectional streaming in the GopherJS gRPC-Web bindings,
thanks to Websockets and our Websocket proxy.

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!

