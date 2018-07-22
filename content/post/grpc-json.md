---
title: "Using gRPC with JSON"
subtitle: "Easy introspection of requests and responses with JSON payloads"
date: 2018-07-21
tags: ["go", "gRPC", "JSON"]
---

## Introduction

It's often said that gRPC is tied to the
[Google Protocol Buffers](https://developers.google.com/protocol-buffers/)
 payload format, but this is not strictly true. While the _default_ format
for gRPC payloads is Protobuf, the gRPC-Go implementation exposes a
[`Codec` interface](https://godoc.org/google.golang.org/grpc/encoding#Codec)
which allows _arbitrary_ payload encoding. This could be used for all kinds of things,
like your own binary format, using [flatbuffers](https://grpc.io/blog/flatbuffers), or,
as we shall see today, using JSON for requests and responses.

## Server setup

I've created [an example repo](https://github.com/johanbrandhorst/grpc-json-example)
with [an implementation](https://github.com/johanbrandhorst/grpc-json-example/tree/master/codec/json.go)
of `grpc/encoding.Codec` for JSON payloads. Server setup is as simple importing the package;

```go
import _ "github.com/johanbrandhorst/grpc-json-example/codec"
```

This registers the JSON `Codec` under the content subtype `json`, which we'll see becomes
important to remember later.

## Request examples

### gRPC client

Using a gRPC Client, simply initiate using the correct content-subtype as a `grpc.DialOption`:

```go
import "github.com/johanbrandhorst/grpc-json-example/codec"
func main() {
    conn := grpc.Dial("localhost:1000",
        grpc.WithDefaultCallOptions(grpc.CallContentSubtype(codec.JSON{}.Name())),
    )
}
```

The example repo includes
[a client](https://github.com/johanbrandhorst/grpc-json-example/tree/master/cmd/client/main.go)
with a full example.

### cURL

More interestingly, it's now possible to basically write our requests (and read responses)
using just cURL! Some request examples:

```bash
$ echo -en '\x00\x00\x00\x00\x17{"id":1,"role":"ADMIN"}' | curl -ss -k --http2 \
        -H "Content-Type: application/grpc+json" \
        -H "TE:trailers" \
        --data-binary @- \
        https://localhost:10000/example.UserService/AddUser | od -bc
0000000 000 000 000 000 002 173 175
         \0  \0  \0  \0 002   {   }
0000007
$ echo -en '\x00\x00\x00\x00\x17{"id":2,"role":"GUEST"}' | curl -ss -k --http2 \
        -H "Content-Type: application/grpc+json" \
        -H "TE:trailers" \
        --data-binary @- \
        https://localhost:10000/example.UserService/AddUser | od -bc
0000000 000 000 000 000 002 173 175
         \0  \0  \0  \0 002   {   }
0000007
$ echo -en '\x00\x00\x00\x00\x02{}' | curl -k --http2 \
        -H "Content-Type: application/grpc+json" \
        -H "TE:trailers" \
        --data-binary @- \
        --output - \
        https://localhost:10000/example.UserService/ListUsers
F{"id":1,"role":"ADMIN","create_date":"2018-07-21T20:18:21.961080119Z"}F{"id":2,"role":"GUEST","create_date":"2018-07-21T20:18:29.225624852Z"}
```

#### Explanation

Using `cURL` to send requests requires manually adding the
[gRPC HTTP2 message payload header](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests)
to the payload:

```bash
'\x00\x00\x00\x00\x17{"id":1,"role":"ADMIN"}'
#<-->----------------------------------------- Compression boolean (1 byte)
#    <-------------->------------------------- Payload size (4 bytes)
#                    <--------------------->-- JSON payload
```

Headers must include `TE` and the correct `Content-Type`:
```bash
 -H "Content-Type: application/grpc+json" -H "TE:trailers"
```

The string after `application/grpc+` in the `Content-Type` header
must match the `Name()` of the codec registered in the server. This
is called the _content subtype_.

The endpoint must match the name of the name of the proto package,
the service and finally the method:

```bash
https://localhost:10000/example.UserService/AddUser
```

The responses are prefixed by the same header as the requests:

```bash
'\0  \0  \0  \0 002   {   }'
#<-->------------------------ Compression boolean (1 byte)
#    <------------>---------- Payload size (4 bytes)
#                     <--->-- JSON payload
```

## Conclusion

We've shown that we can easily use JSON payloads with gRPC, even allowing
us to send cURL requests with JSON payloads directly to our gRPC servers,
no proxies, no grpc-gateway, no setup except for importing a package necessary.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
