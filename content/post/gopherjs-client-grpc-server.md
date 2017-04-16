+++
date = "2017-03-23T21:47:32Z"
draft = true
title = "GopherJS Client and gRPC Server"

+++

I've been using [gRPC](http://www.grpc.io/) and [Go](https://golang.org/) a lot in the last year. At [Cognitive Logic](https://www.cognitivelogic.com) every one of our backend services is implemented with Go and gRPC, and it enables us to abstract away most of the complexities of networked micro services and keep interfaces typed and well defined using [Google protobuffers](https://developers.google.com/protocol-buffers/).

I really enjoy using both, but sometimes I need to write a frontend to a web server and I despise writing Javascript. So what do? Use Go of course!

With [GopherJS](https://github.com/gopherjs/gopherjs) it's possible to write safe statically typed code that transpiles to Javascript. It comes with a couple of quirks but as long as I don't have to use Javascript I'm happy.

Naturally, I want to be able to use Go and gRPC in the backend as well if I can, and with the use of the [gRPC HTTP Gateway](https://github.com/grpc-ecosystem/grpc-gateway) it becomes as simple as writing a normal gRPC service.

So what are the steps required to get a GopherJS frontend client talking to a gRPC backend seamlessly? In short:

* Create the protobuf interface
* Implement the server
* Implement the client

If you want to skip ahead, the finished example can be found on [my github](https://github.com/johanbrandhorst/gopherjs-grpc-websocket).

# Preparation
Some structure will help organization. Let's create a `client`, `server`, and `protos` folder:

```bash
$ tree -L 1 -d
.
|-- client
|-- protos
`-- server
```

Next up we'll create the proto interface.

# Create the protobuf interface
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
and run it with the Go, gRPC-gateway and
[gopherjs](https://github.com/johanbrandhorst/protoc-gen-gopherjs) plugins:

```bash
$ protoc protos/server/server.proto \
    # Generate Go gRPC stubs.
    # Output is relative to the go_package option,
    # hence the reference to $GOPATH/src.
    --go_out=plugins=grpc:$GOPATH/src \
    # Generate Go gRPC-gateway proxy.
    # Output is relative to file path.
    --grpc-gateway_out=logtostderr=true:./ \
    # Generate GopherJS client structs.
    # Output is relative to file path.
    --gopherjs_out=:./client \
    # Add include paths (in order of importance)
    -I./ \
    # For google/api/annotations.proto
    -I./vendor/github.com/googleapis/googleapis/ \
```

We'll end up with the files `protos/server/server.pb.go`, `protos/server/server.pb.gw.go` and `client/protos/server/server.pb.gopherjs.go`.
The first two belong to the server, and the last one the client.
Now we're ready to implement the server.

# Implement the server
I like to start by creating a struct and write a simple definition that'll
immediately fail to compile.

```go
package server

import (
	"github.com/johanbrandhorst/gopherjs-grpc-websocket/protos/server"
)

type Server struct{}

var _ server.MyServerServer = &Server{}
```

This won't compile, because the `Server` struct does not implement the
`server.MyServerServer` interface. But it'll also tell us what we've got
left to implement. So lets implement the server methods:

```go
func (s Server) Simple(ctx context.Context, _ *empty.Empty) (*server.MyMessage, error) {
	return &server.MyMessage{
		Msg: "A simple message",
	}, nil
}
```

The `Simple` method gets a simple implementation, returning a simple message.

```go
func (s Server) Unary(_ *empty.Empty, srv server.MyServer_UnaryServer) error {
	// Send 4 messages
	for i := uint32(0); i < 4; i++ {
		msg := &server.MyMessage{
			Msg: "A unary message",
			Num: i,
		}

		if err := srv.Send(msg); err != nil {
			return err
		}

		// Sleep to simulate some work
		time.Sleep(time.Second)
	}

	return nil
}
```

The `Unary` method simulates a longer running function that does some work and
periodically replies with some result.

```go
func (s Server) Bidi(srv server.MyServer_BidiServer) error {
	for i := uint32(0); ; i++ {
		// Blocks until a message is received
		msg, err := srv.Recv()
		if err != nil {
			if err == io.EOF {
				// Client closed connection
				return nil
			}

			return err
		}

		// Just echo back the message sent,
		// incrementing the counter
		msg.Num = i
		if err := srv.Send(msg); err != nil {
			return err
		}
	}
}
```

The `Bidi` method listens for any messages sent over the stream and echoes the message back,
incrementing the counter each time. This is a very simple use of the gRPC bidi server, but since
what we're really interested in here is the client implementation, it'll do.

Now that we're done with the server, we can start looking at the client implementation.

# Implement the client

