---
date: 2017-07-14
subtitle: "Using gRPC server-side streaming with binary blobs"
tags: ["golang", "gRPC", "protobuf"]
title: Chunking large messages with gRPC
---

One of the gotchas of using gRPC is that it was not designed to transport
large messages in one chunk. The default max message size is [slightly arbitrarily
set at 4MB](https://github.com/grpc/grpc-java/issues/1676#issuecomment-229809402)
today, and while it is possible to configure, that kind of behaviour might lead
to a slippery slope scenario of ever increasing max message sizes. So what do we
do when the message size is too large? We chunk the data into smaller pieces and
stream it, using the gRPC streaming methods, naturally.

TL;DR? Code is [available on my github](https://github.com/johanbrandhorst/chunker).

## Server-side streaming
We'll define a protofile with a single service exposing a single method returning
a streamed message type.

```protobuf
syntax = "proto3";

package chunker;

option go_package = "github.com/johanbrandhorst/chunker/protos/chunker";

import "google/protobuf/empty.proto";

service Chunker {
    rpc Chunker(google.protobuf.Empty) returns (stream Chunk) {}
}

message Chunk {
    bytes chunk = 1;
}
```

Then we implement the server. I thought I'd be clever and show that you don't
necessarily have to implement the gRPC interface on a struct.
The recommended chunk size for streamed messages
[appears to be 16-64KiB](https://github.com/grpc/grpc.github.io/issues/371).
We'll go for 64KiB today.

```go
const chunkSize = 64 * 1024 // 64 KiB

type chunkerSrv []byte

func (c chunkerSrv) Chunker(_ *empty.Empty, srv chunker.Chunker_ChunkerServer) error {
	chnk := &chunker.Chunk{}
	for currentByte := 0; currentByte < len(c); currentByte += chunkSize {
		if currentByte+chunkSize > len(c) {
			chnk.Chunk = c[currentByte:len(c)]
		} else {
			chnk.Chunk = c[currentByte : currentByte+chunkSize]
		}
		if err := srv.Send(chnk); err != nil {
			return err
		}
	}

	return nil
}
```

We wrap this in a gRPC server and host it:

```go
func main() {
	lis, err := net.Listen("tcp", ":10000")
	if err != nil {
		panic(err)
	}

	g := grpc.NewServer()
	blob := make([]byte, 128*1024*1024) // 128MiB
	rand.Read(blob)
	chunker.RegisterChunkerServer(g, chunkerSrv(blob))

	log.Println("Serving on :10000")
	log.Fatalln(g.Serve(lis))
}
```

This is all the server code. And this is how you would consume it:

```go
func main() {
	conn, err := grpc.Dial(":10000", grpc.WithInsecure())
	if err != nil {
		panic(err)
	}

	cc := chunker.NewChunkerClient(conn)
	client, err := cc.Chunker(context.Background(), &empty.Empty{})
	if err != nil {
		panic(err)
	}

	var blob []byte
	for {
		c, err := client.Recv()
		if err != nil {
			if err == io.EOF {
				log.Printf("Transfer of %d bytes successful", len(blob))
				return
			}

			panic(err)
		}

		blob = append(blob, c.Chunk...)
	}
}
```

That's all there is to it. Obviously the chunking can be done on anything
that can be marshalled to a byte slice, including other proto messages.

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!
