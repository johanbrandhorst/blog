---
title: "So you want to use GoGo Protobuf"
date: 2018-02-19
subtitle: "Best practices for using GoGo Protobuf"
tags: ["golang","protobuf", "gogoprotobuf", "grpc", "grpc-gateway"]
---

## Introduction

In the Go protobuf ecosystem there are two major implementations
to choose from. There's the official
[golang/protobuf](https://github.com/golang/protobuf), which uses
reflection to marshal and unmarshal structs, and there's
[gogo/protobuf](https://github.com/gogo/protobuf), a third party
implementation that leverages type-specific marshalling code for
extra performance, _and_ has many cool extensions you can use to
customize the generated code. `gogo/protobuf` has been recommended
as the best choice of Go serialization library in a
[large test of different implementations](https://github.com/alecthomas/go_serialization_benchmarks#recommendation).

Unfortunately, the design of `golang/protobuf` and the gRPC ecosystem
makes it hard to integrate third party implementations,
and there are certain situations where using `gogo/protobuf`
with gRPC can break unexpectedly, at _runtime_.
In this post I will try to cover best practices for
working with `gogo/protobuf`.

### _Update_
`golang/protobuf` is in the process of a big refactoring to,
among other things, make interoperability with `gogo/protobuf` easier. See
[the design document](https://docs.google.com/document/d/19kfhro7-CnBdFqFk7l4_HmwaH2JT_Rhw5-2FLWLEGGk)
and subscribe to [the issue](https://github.com/golang/protobuf/issues/364)
to stay up to date on the progress!

## TL;DR?

I made an example repo of using `gogo/protobuf` with various parts of the
greater gRPC ecosystem, graciously hosted under the `gogo` namespace by
[Walter Schulze](https://github.com/awalterschulze), complete with a
gRPC-Gateway and OpenAPI UI:

[https://github.com/gogo/grpc-example](https://github.com/gogo/grpc-example)

![gRPC-Example repo in action](/img/swagger.png)

If you find anything that isn't listed on there, or in this post, please
submit an issue against this repo, and I will attempt to implement a
workaround or raise a relevant issue upstream.

Still here? Lets move on to the details.

## GoogleAPIs

The [google/googleapis](https://github.com/google/googleapis)
and [golang/genproto](https://github.com/golang/genproto) repos
provide a large number of protofiles and pre-generated Go files, all
maintained by Google's engineers. However, because they use `protoc-gen-go`
to compile the Go files, they are not strictly compatible with
`gogo/protobuf`, as they do not register with the correct backend.

Instead, if you find you need to reach for these pre-compiled files,
use [gogo/googleapis](https://github.com/gogo/googleapis).
This contains a growing number of Go files pre-generated with
`protoc-gen-gogo`, and registering against the correct backend.
If there are any files missing from this repo, make sure to raise
an issue (or make a PR) and it'll be added in no time.

_Bonus_: because the generated files are in the same folder as the proto
files, including the files works with [golang/dep](https://github.com/golang/dep),
[limitations on including non-go files notwithstanding](https://github.com/golang/dep/issues/1306).

## Protobuf Any types

The [google.protobuf.Any](https://developers.google.com/protocol-buffers/docs/proto3#any)
type is used in a wide variety of the GoogleAPIs proto messages,
but using it with `gogo/protobuf` requires extra care. The `Any`
message types work by using the internal "registry" of the protobuf
package used, so you need to make sure any messages you stick in
an `Any` container have been generated with `gogo/protobuf`.
Using the `gogo/googleapis` repo is a great start, but the general
rule of thumb is to ensure all protofiles are generated with
`gogo/protobuf`.

## gRPC

gRPC is designed to be payload agnostic, and will work out of the
box with `gogo/protobuf`, as while it imports `golang/protobuf`,
it only uses it to
[type assert incoming interfaces](https://github.com/grpc/grpc-go/blob/dfa18343df54bda471a4b53677aa7c0d0df882d1/encoding/proto/proto.go)
into interfaces that are equally supported by all `gogo/protobuf` types.

### Reflection

gRPC has this cool thing called
[server reflection](https://github.com/grpc/grpc-go/blob/master/Documentation/server-reflection-tutorial.md),
which allows a client to use a gRPC server without having to use
the servers protofile, dynamically, at runtime. Some tools such as
[grpc-ecosystem/polyglot](https://github.com/grpc-ecosystem/polyglot),
[ktr0731/evans](https://github.com/ktr0731/evans),
[kazegusuri/grpcurl](https://github.com/kazegusuri/grpcurl)
and [fullstorydev/grpcurl](https://github.com/fullstorydev/grpcurl)
(popular pun) have support for dynamic reflection based requests today.

Unfortunately, `gogo/protobuf` is currently not working perfectly
with server reflection, because the grpc-go implementation is
[very tightly coupled](https://github.com/grpc/grpc-go/issues/1873)
with `golang/protobuf`. This presents a couple of different scenarios
where using `gogo/protobuf` may or may not work:

1. If you use just the `protoc-gen-gofast` generator, which simply
    generates type specific marshalling and unmarshalling code,
    you'll be fine. Of course, using `protoc-gen-gofast` still
    comes with downsides, such as having to
    [regenerate the whole proto dependency tree](https://github.com/gogo/protobuf/issues/325).
2. If you use `protoc-gen-gogo*`, unfortunately, reflection will
    not work on your server. This is because
    [gogo.pb.go](https://github.com/gogo/protobuf/blob/master/gogoproto/gogo.pb.go)
    does not register itself with `golang/protobuf`, and reflection
    recursively resolves all imports, and will complain of
    `gogo.proto` not being found.

This is of course quite disappointing, but I've discussed
with [Walter Schulze](https://github.com/awalterschulze)
(the maintainer of `gogo/protobuf`) how best to solve this and
[raised an issue against grpc-go](https://github.com/grpc/grpc-go/issues/1873).
If the maintainers of grpc-go do not want to make it easier
to use with `gogo/protobuf`, there are other alternatives.
I'll update this post once I know more.

## gRPC-Gateway

The gRPC-Gateway is another popular project, and at first it
might seem completely compatible `gogo/protobuf`. However,
it suffers from a number of incompatibilities, most of which
can be traced to its liberal use of `golang/protobuf` packages directly:

1. The gRPC-Gateway [does not work with `gogo/protobuf` registered enums](https://github.com/grpc-ecosystem/grpc-gateway/issues/320).
1. The default JSON marshaller used by the gRPC-Gateway is unable
to marshal [non-nullable non-scalar fields](https://github.com/gogo/protobuf/issues/178).
1. [A bug in the generator](https://github.com/grpc-ecosystem/grpc-gateway/issues/229)
means generated files with _Well Known Types_ need post-generation corrections.

Fortunately, workarounds exist for these problems.
Using the [`goproto_registration` extension](https://github.com/gogo/protobuf/blob/master/extensions.md#goprotobuf-compatibility)
of `gogo/protobuf` will ensure enum resolution works.
Using the [`gogo/gateway` package](https://github.com/gogo/gateway)
with the gRPC-Gateway
[`WithMarshaler` option](https://github.com/gogo/grpc-example/blob/6c217371b67a89609c632f047477fa5a1123ac93/main.go#L98)
fixes the scalar field marshalling issue.

Both of these workarounds are implemented in the
[gRPC-example repo](https://github.com/gogo/grpc-example).

As for the incorrect import, a simple `sed` post-generation
will sort that out (adjust as necessary):

```bash
$ sed -i "s/empty.Empty/types.Empty/g" <file.pb.gw.go>
```

Note that the gRPC-Gateway makes use of `google/api/annotations.proto`,
so make sure you include the correct file from `gogo/googleapis` as
mentioned when compiling your proto files.

# Conclusion

Unfortunately, while `gogo/protobuf` delivers awesome customization
options and faster marshalling, getting it working well with the
larger gRPC ecosystem is complicated. `gogo/protobuf` has it as a
stated goal to be merged back into `golang/protobuf`, and
[recent discussions](https://groups.google.com/d/msg/golang-nuts/F5xFHTfwRnY/sPv5nTVXBQAJ)
have been positive, but it's hard to say whether it'll lead to anything.
There is also [an open issue](https://github.com/golang/protobuf/issues/280)
discussing the possibility of type specific marshalling and unmarshalling code
in `golang/protobuf` itself, which is what I think is the biggest reason
most users turn to `gogo/protobuf`.

In a perfect future, we'd have some or all of the customizability and speed of
`gogo/protobuf` with the official backing of `golang/protobuf`.

### _Update_
[Joe Tsai](https://github.com/dsnet), one of the developers working on
`golang/protobuf` at Google, provided
[the following perspective](https://gophers.slack.com/archives/C0FSEE1UJ/p1527799668000700)
on whether any parts of `gogo/protobuf` could be merged into upstream:

> Go protobufs were originally written by Rob Pike back in 2009
(before the release of Go1) and was designed in a fashion similar
to `encoding/json` where structs were marshaled based on the presence
of the `protobuf` field tag. In fact, there was no `proto.Message`
interface and `Marshal` and `Unmarshal` just operated on `interface{}`.
Back then, protobufs (as a language) were simpler and the equivalent
Go structs were more idiomatic. In fact the struct field tag syntax
was simple enough back then that you could easily hand-craft a Go
struct to act like a proto message. However, overtime more features
have crept into protobufs (oneofs and maps added in 2014, proto3
unknown fields in 2018, and probably more in the future).
These features have increasingly made Go’s representation less
idiomatic. For example, oneofs have no natural representation
in Go and has a fairly clunky API. The implementation of proto3
unknown field preservation also forces the existence of some
other field to hold the unknown data. Simply put, the field
tag syntax has grown more complex and is practically not
hand-writable today, and generated messages are increasingly
less idiomatic Go like.

> The `gogo/protobuf` fork occured in 2013
and one of the stated goals is to provide “more canonical Go
structures”, which is a significant reason why users prefer
it over `golang/protobuf`. There are great number of options a
user may specify in their proto file to customize the generated struct
(https://github.com/gogo/protobuf/blob/master/extensions.md).

> A few days ago I asked whether Go protobufs were used primarily in
Go <-> Go communication, or Go <-> other language communication and
it seemed that many users are in pure Go. I suspect that this fact
is a source of contention between `golang/protobuf`, `gogo/protobuf`,
and the users in the Go community. Each party have slightly different
motivations:

> * `golang/protobuf` lies within the larger spectrum of language specific
proto implementations (e.g., C++, Java, C#, JavaScript, etc) and
follows the guidance of the proto team. The proto team is heavily
concerned with uniformity of behavior across all languages, and less
so about making protos great in any one particular language.

> * `gogo/protobuf` is very Go centric and provides many user-tweakable
knobs to adjust the generated struct. Naturally, `gogo/protobuf` appeals
heavily to the Go community.

> That all being said, regarding merging `gogo/protobuf` into `golang/protobuf`:

> * Any features that violate protobuf semantics cannot be merged
(e.g., the ability to disable nullability).

> * Furthermore, I’ve spoken to the proto team, and they were hesitant
to adopt to language specific customizations. If Go were to add
options to customize the generated code, then that sets precedence
for other languages to do likewise. This becomes a slippery slope
where a proto file could become an unreadable mess with
language-specific options everywhere.

> Personally, I’m a Go programmer and I understand the desire for
idiomatic Go messages in a very Go centric world, but I also represent
the interests of the proto team who prioritizes uniformity across all
programming languages (a reasonable stance to hold). I don’t know if certain
`gogo/protobuf` features will be merged, but I’m currently focusing
my time and effort into https://github.com/golang/protobuf/issues/364,
which should pave the way for `golang/protobuf` and `gogo/protobuf` to
be able to interoperate. Further discussions on merging can come after that.

## More reading

I made [a repo](https://github.com/johanbrandhorst/gogoproto-experiments)
for experimenting with various go proto generators
that you can check out if you want to make your own tests.

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!
