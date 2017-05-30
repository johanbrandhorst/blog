+++
date = "2017-04-11"
title = "GopherJS Client and gRPC Server - Part 1"
subtitle = "A guide to implementing a GopherJS frontend to a gRPC backend exposed over HTTP via the gRPC-gateway"
tags = [ "golang", "protobuf", "grpc", "grpc-gateway", "gopherjs" ]
+++
## Create the protobuf interface

We'll start by creating a folder for the package we want to create. Lets call it `server`.
Next we type up a `.proto` file to define the interface between the server and the client.
We'll have to include some extra
[proto annotations](https://github.com/googleapis/googleapis/blob/f83f68b532d7423f1713d8ec56b16badc0955b6a/google/api/http.proto#L37) in order to have the gRPC-gateway generate the translations methods we need. Lets define a simple service with a single `HTTP GET` endpoint:

```protobuf
service MyServer {
    rpc Simple(google.protobuf.Empty) returns (MyMessage) {
        option (google.api.http) = {
            get: "/api/v1/simple"
        };
    }
}

message MyMessage {
    string msg = 1;
    uint32 num = 2;
}
```

This creates a new endpoint, `Simple`, with takes a `google.protobuf.Empty` type as input
(that is, no input), and returns a `MyMessage` type. From this, the gRPC-gateway will generate
an endpoint that translates a `HTTP GET` on `/api/v1/simple` to a gRPC call to the `Simple`
function, translating the returned data (or error) back to HTTP. If you're interested in how
gRPC errors are translated to HTTP Status codes, you can take a look at
[the grpc-gateway source](https://github.com/grpc-ecosystem/grpc-gateway/blob/2ad234c172af14e85f3be9546f6c64c768d4eccd/runtime/errors.go).

Lets make things a bit more interesting and throw in a couple of streaming endpoints as well:

```protobuf
service MyServer {
    ...
    rpc Unary(google.protobuf.Empty) returns (stream MyMessage) {
        option (google.api.http) = {
            get: "/api/v1/unary"
        };
    }
    rpc Bidi(stream MyMessage) returns (stream MyMessage) {
        option (google.api.http) = {
            get: "/api/v1/bidi"
        };
    }
}
```

The streaming endpoints are a bit more complicated, as they don't readily translate to
the simple HTTP methods. Unary streaming functions are supported by the gRPC-gateway,
as we'll see when we implement the client. Bi-directional streaming is not (currently!)
supported natively by the gRPC-gateway, but it can be remedied by wrapping the gRPC-gateway
mux in the [grpc-websocket-proxy](https://github.com/tmc/grpc-websocket-proxy). This
allows us to use websockets from the client in order to consume bidi endpoints.

The complete protobuf file (with imports and options) can be viewed
[on github](https://github.com/johanbrandhorst/gopherjs-grpc-websocket/blob/5aa1d17633c077a52a48393a4d8678a187e43a12/protos/server/server.proto).
Now that we've got the protobuf interface defined we'll just need to generate the
files that we'll interface with in the Go code. We'll whip out our trusty `protoc` compiler
and run it with the Go and gRPC-gateway plugins:

```bash
$ protoc protos/server/server.proto \
    # Generate Go gRPC stubs.
    # Output is relative to the go_package option,
    # hence the reference to $GOPATH/src.
    --go_out=plugins=grpc:$GOPATH/src \
    # Generate Go gRPC-gateway proxy.
    # Output is relative to file path.
    --grpc-gateway_out=logtostderr=true:./ \
    # Add include paths (in order of importance)
    -I./ \
    # For google/api/annotations.proto
    -I./vendor/github.com/googleapis/googleapis/ \
```

We'll end up with the files `protos/server/server.pb.go` and `protos/server/server.pb.gw.go`.
Now we're ready to implement the server.
