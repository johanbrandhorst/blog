+++
date = "2017-04-12"
title = "GopherJS Client and gRPC Server - Part 2"
subtitle ="A guide to implementing a GopherJS frontend to a gRPC backend exposed over HTTP via the gRPC-gateway"
tags = [ "golang", "protobuf", "grpc", "grpc-gateway", "gopherjs" ]
+++
## Implement the server

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
