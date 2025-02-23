---
title: "Go Protobuf Plugin Versioning"
subtitle: "Avoiding common pitfalls in plugin versioning"
date: 2022-10-20
tags: ["protobuf", "grpc", "buf", "go", "modules"]
---

## Update on Go 1.24 tool dependencies

Go 1.24 introduced the `-tool` flag to `go get` and the `tool` stanza to `go.mod`. This makes tool dependencies an excellent way to manage protobuf plugins. I have
rewritten this post with that in mind.

## Background

When working with Protobuf and gRPC, one of the first things that you as a
user has to figure out is how to generate code from your Protobuf
definitions. When working with Go, this means understanding how to install the
Go Protobuf and gRPC plugins. That might seem simple, but anyone who has had
to manage Go Protobuf and gRPC generation within an organization knows that a
few issues pop up immediately:

- How do we ensure that users are using the same _versions_ of plugins?

  The Go Protobuf Plugins generally produce slightly different code from
  version to version, so unless everyone is on the same version, you can end
  up with small changes every time a user reruns generation. This can be
  confusing, as it's unclear why so many files change, and it makes
  reviewers job harder, as they have to constantly skim over files changes
  that are unrelated to the code being reviewed. More alarmingly, generated
  code behavior may differ from developer to developer!

- How do we ensure that plugins and the associated libraries are compatible?

  Most popular Go Protobuf plugins have some sort of library dependency for
  much of their functionality, including Go, Go-gRPC and the gRPC-Gateway.
  The generated files produced by the plugins are generally compatible with
  a range of versions from their respective runtime libraries, but to be safe
  it is recommended that the version of the plugin and the runtime library is
  the same.

## The state of the art

There are a number of ways that I have seen teams approach this problem,
including:

- Using a Docker image with pre-installed versions of all plugins

  This doesn't solve the problem of ensuring that the plugins and library
  versions are the same, since generally the `Dockerfile` will include a
  number of lines along lines of

  ```Dockerfile
  RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.20.0
  ...
  ```

  Sometimes this `Dockerfile` also lives in a different repo from where it is
  used, and may be used across multiple repositories, so updating versions
  becomes a dance of hoping-it-doesn't-break-anyone.

- Using "tool dependencies"

  The
  [tool dependencies](https://github.com/golang/go/wiki/Modules#how-can-i-track-tool-dependencies-for-a-module)
  pattern is a somewhat "blessed" model of versioning tools in Go modules
  land, but it can come with downsides. The reason for this is
  that adding a tool dependency this way adds all of its dependencies to your
  dependency closure, meaning that you might end up choosing versions of
  dependencies that are pinned by the tool, or worse, building the tool with a
  set of dependencies that it has not been tested with. This causes real
  problems
  [in the wild](https://github.com/cockroachdb/cockroach/issues/67473), such
  as panics and unexpected behavior.

- Using Buf's remote plugin execution

  The [Buf Schema Registry](https://buf.build/explore)
  [remote plugins](https://buf.build/docs/bsr/remote-plugins/overview/)
  feature is great for simplifying plugin versioning in general (disclaimer:
  I worked on this). However, it still doesn't solve the issue of enforcing
  that plugin versions and library versions are the same, as it requires you
  to version the plugin in your `buf.gen.yaml` while versioning your library
  dependency in your `go.mod` (or directly in a `go install` command). Short
  of using dynamic generation templates with plugin version information
  populated from some other single source of truth, this doesn't quite solve
  our problem either, and even if we wanted to go down that path, using
  remote plugins may not be possible in every environment.

- Using the [Buf Schema Registry Generated SDKs](https://buf.build/docs/bsr/generated-sdks/overview/)

  This _does_ solve both plugin versioning and runtime library versioning, as
  its all handled on the BSR for you, and the module zip returned from the BSR
  declares the runtime library version that it needs to run with. However, it
  requires you to keep all of your Protobuf definitions on the BSR,
  which is not yet possible for everyone.

Having listed all of the known ways to solve this, and their drawbacks, I
today want to discuss a less known way of solving this problem using Go's
modern version installation tooling.

## Go 1.24 tool dependencies

With Go 1.24, we can version the tool dependencies using Go modules and still execute the tools at the right version using the Go tool. Let me illustrate with an example.

> If you just want to see the code, I've put together an
> [example repo](https://github.com/johanbrandhorst/go-protobuf-plugin-versioning-example).

## An example project

Say you want to use `protoc-gen-go`, `protoc-gen-go-grpc` and
`protoc-gen-grpc-gateway` to build an application in Go that uses gRPC and the
gRPC-gateway. The first thing we'll do is figure out the versions we want to
use. This is a greenfield project, so we'll just use the (currently) latest
versions:

| Plugin name               | Version   |
| ------------------------- | --------- |
| `protoc-gen-go`           | `v1.36.5` |
| `protoc-gen-go-grpc`      | `v1.5.1`  |
| `protoc-gen-grpc-gateway` | `v2.26.1` |

Now, remembering the second point from above, we need to ensure (as much as we
can) that the version of the plugin we use generates code that is compatible
with the version of its runtime library in our `go.mod` file. The best way to
do this is via the use of a so-called "tool dependency". It is the easiest way to ensure that code generator and runtime library are the same version.

### Improving tool dependencies

As a quick primer, adding a "tool dependency" means executing `go get -tool <tool module path/path to tool main.go>`. In our case, it looks like this (for `protoc-gen-go`):

```shell
$ go get -tool google.golang.org/protobuf/cmd/protoc-gen-go
```

After running this, the Go tool will add this package to your dependency closure (as an indirect dependency), and add a new `tool` stanza to your `go.mod` file. It will look like this:

```
tool (
	google.golang.org/protobuf/cmd/protoc-gen-go
)
```

This will be the same version of the `google.golang.org/protobuf`
library used by the generated code, avoiding any version differences. We can run
the tool using

```shell
$ go tool protoc-gen-go
```

This will download, build and _run_ the version of `protoc-gen-go` that is
specified in our `go.mod` file. Of course, it will also cache any build
artifacts so this only takes any significant time the first time you run it
for each version.

We can now add the other tools we want:

```shell
$ go get -tool google.golang.org/grpc/cmd/protoc-gen-go-grpc
$ go get -tool github.com/grpc-ecosystem/grpc-gateway/protoc-gen-grpc-gateway
```

## Generating using Buf

To use our tools with `buf` , use a `buf.gen.yaml` similar to this:

```yaml
version: v2
plugins:
  - local: ["go", "tool", "protoc-gen-go"]
    out: gen/go
    opt:
      - paths=source_relative
  - local: ["go", "tool", "protoc-gen-go-grpc"]
    out: gen/go
    opt:
      - paths=source_relative
  - local: ["go", "tool", "protoc-gen-grpc-gateway"]
    out: gen/go
    opt:
      - paths=source_relative
```

And run

```shell
$ buf generate
```

This tells `buf` to use the Go tool to execute the tools managed in your Go module.

## Generating using protoc

Generating using `protoc` is a little trickier, since it expects a single executable. How do we get
it to run `go tool protoc-gen-go` when it expects to just execute an executable? Bash to the rescue!

```bash
#!/usr/bin/env bash

exec go tool protoc-gen-go
```

Once we mark this file as executable, we can use it as a Protoc plugin, as
bash will pass standard in and standard out to the command we execute, which will
run the plugin at the desired version. We can name this file `protoc-gen-go`
and put it in a directory in our repository (e.g., `/bin`).

To generate with `protoc`:

```shell
$ protoc \
  --plugin=protoc-gen-go=$(pwd)/bin/protoc-gen-go --go_out=./gen/go --go_opt=paths=source_relative \
  --plugin=protoc-gen-go-grpc=$(pwd)/bin/protoc-gen-go-grpc --go-grpc_out=./gen/go --go=grpc_opt=paths=source_relative \
  --plugin=protoc-gen-grpc-gateway=$(pwd)/bin/protoc-gen-grpc-gateway --grpc-gateway_out=./gen/go --grpc-gateway_opt=paths=source_relative \
  <path to proto files>
```

Or, if you prefer using `$PATH` overrides:

```shell
$ PATH=$(pwd)/bin/:$PATH protoc \
  --go_out=./gen/go --go_opt=paths=source_relative \
  --go-grpc_out=./gen/go --go=grpc_opt=paths=source_relative \
  --grpc-gateway_out=./gen/go --grpc-gateway_opt=paths=source_relative \
  <path to proto files>
```

## Encore

Now, the astute reader will know that `buf` is also a Go tool and can be
versioned in the same way. Instead of requiring the user to install `buf` at
a specific version, we could write a `go generate` directive that runs it like
we do `protoc-gen-go`:

```go
package main

//go:generate go run github.com/bufbuild/buf/cmd/buf@v1.50.0 generate
```

That means the only thing we have to run to download `buf` and all the plugins
we use is:

```shell
$ go generate ./...
```

How neat is that?

## Conclusion

We've learned why Go Protobuf plugin management is important, and explored a
few of the most common solutions people use today. We've dived deeper into the
use of tool dependencies for Go protobuf plugin management.

See the
[example repo](https://github.com/johanbrandhorst/go-protobuf-plugin-versioning-example)
for a complete example of using this method for managing your Go Protobuf
plugin versions.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
