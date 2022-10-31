---
title: "Go Protobuf Plugin Versioning"
subtitle: "Avoiding common pitfalls in plugin versioning"
date: 2022-10-20
tags: ["protobuf", "grpc", "buf", "go", "modules"]
---

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
  that are unrelated to the code being reviewed.

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
  land, but I generally advice against it nowadays. The reason for this is
  that adding a tool dependency this way adds all of its dependencies to your
  dependency closure, meaning that you might end up choosing versions of
  dependencies that are pinned by the tool, or worse, building the tool with a
  set of dependencies that it has not been tested with. This causes real
  problems
  [in the wild](https://github.com/cockroachdb/cockroach/issues/67473), such
  as panics and unexpected behavior. Even aside from that, in order to
  ensure that the right plugin version is used, it usually requires a
  `go install` step before generation. More on that later!

- Using Buf's remote plugin execution

  The [Buf Schema Registry](https://buf.build/explore)
  [remote plugin execution](https://docs.buf.build/bsr/remote-generation/remote-plugin-execution)
  feature is great for simplifying plugin versioning in general (disclaimer:
  I worked on this). However, it still doesn't solve the issue of enforcing
  that plugin versions and library versions are the same, as it requires you
  to version the plugin in your `buf.gen.yaml` while versioning your library
  dependency in your `go.mod` (or directly in a `go install` command). Short
  of using dynamic generation templates with plugin version information
  populated from some other single source of truth, this doesn't quite solve
  our problem either, and even if we wanted to go down that path, using
  remote plugins may not be possible in every environment.

- Using the [BSR Go Proxy](https://docs.buf.build/bsr/remote-generation/overview)

  This _does_ solve both plugin versioning and runtime library versioning, as
  its all handled on the BSR for you, and the module zip returned from the BSR
  declares the runtime library version that it needs to run with. However, BSR
  remote generation is still in alpha, and it also requires you to keep all of
  your Protobuf definitions on the BSR, which is not yet possible for
  everyone.

Having listed all of the known ways to solve this, and their drawbacks, I
today want to discuss a less known way of solving this problem using Go's
modern version installation tooling.

## A different approach

What if we could combine the best of the tool dependencies workflow with the
best of the BSR remote plugin execution workflow?
[Andrew Allen](https://andrewzallen.com) recently introduced me to an elegant
solution that avoids _almost_ all the problems listed above. The basic idea is
to use tool dependencies when we're forced to, and explicitly versioned
plugins when we can, downloaded, built and run at execution time. Let me
illustrate with an example.

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
| `protoc-gen-go`           | `v1.28.0` |
| `protoc-gen-go-grpc`      | `v1.2.0`  |
| `protoc-gen-grpc-gateway` | `v2.12.0` |

Now, remembering the second point from above, we need to ensure (as much as we
can) that the version of the plugin we use generates code that is compatible
with the version of its runtime library in our `go.mod` file. The best way to
do this is via the use of a so-called "tool dependency". I mentioned why I
didn't love this solution generally, but when the plugin and runtime library
is in the same module, it is the easiest way to ensure that they are the same
version.

### Improving tool dependencies

As a quick primer, using a "tool dependency" means creating a `tools.go` file
somewhere in your module which contains the install path for the tool you want
to install _as an import statement_. In our case, it looks like this (for
`protoc-gen-go`):

```go
//go:build tools

package tools

import (
  _ "google.golang.org/protobuf/cmd/protoc-gen-go"
)
```

After putting this in your module and running `go mod tidy`, the Go tool will
add this package to your dependency closure, as explained, which means you can
run

```shell
$ go install google.golang.org/protobuf/cmd/protoc-gen-go
```

to download and build the binary at the version specified in your `go.mod`
file. This will be the same version of the `google.golang.org/protobuf`
library used by the generated code, avoiding any version differences.

One of the things I complained about with "tool dependencies" earlier is that
it often requires this separate installation step, to avoid accidentally using
the wrong plugin version if the user already has a version of the plugin
installed. Turns out there is something we can do to avoid this problem! We
simply use `go run` instead of `go install`.

```shell
$ go run google.golang.org/protobuf/cmd/protoc-gen-go
```

This will download, build and _run_ the version of `protoc-gen-go` that is
specified in our `go.mod` file. Of course, it will also cache any build
artifacts so this only takes any significant time the first time you run it
for each version.

There's still one problem, which is that we don't actually want to invoke the
tool directly, we need `protoc` or `buf` to invoke it for us. So how do we get
them to run `go run` when they expect to just execute an executable? Bash to
the rescue!

```bash
#!/usr/bin/env bash

exec go run google.golang.org/protobuf/cmd/protoc-gen-go
```

Once we mark this file as executable, we can use it as a Protobuf plugin, as
bash will pass standard in and standard out to the command we execute, which
in this case will, as mentioned, download, build and run the plugin at the
desired version. We can name this file `protoc-gen-go` and put it in a
directory in our repository.

This works great for both `protoc-gen-go` and `protoc-gen-grpc-gateway`.
However, notice how I said "when the plugin and runtime library is in the same
module". Lets look at the plugins again and see what modules they are in.

| Plugin name               | Module name                                     |
| ------------------------- | ----------------------------------------------- |
| `protoc-gen-go`           | `google.golang.org/protobuf`                    |
| `protoc-gen-go-grpc`      | `google.golang.org/grpc/cmd/protoc-gen-go-grpc` |
| `protoc-gen-grpc-gateway` | `github.com/grpc-ecosystem/grpc-gateway/v2`     |

Lets also take a quick look at which runtime library dependency the code
generated by each of the plugins use.

| Plugin name               | Runtime library dependency module name      |
| ------------------------- | ------------------------------------------- |
| `protoc-gen-go`           | `google.golang.org/protobuf`                |
| `protoc-gen-go-grpc`      | `google.golang.org/grpc`                    |
| `protoc-gen-grpc-gateway` | `github.com/grpc-ecosystem/grpc-gateway/v2` |

If you look closely, you'll notice that `protoc-gen-go-grpc` is actually in
its own module, separate from its runtime library dependency. This is a bit
unusual, and it means that we can't rely on a "tool dependency" for ensuring
that we install a plugin whose generated code is compatible with its runtime
library. In this case, I recommend just versioning the tool manually.

Since [Go 1.17](https://go.dev/doc/go1.17) `go run` accepts parameters
allowing users to download, build and run tools at a specific version. Simply
specify the version after the package name:

```shell
$ go run google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.2.0
```

[Alex Edwards](https://www.alexedwards.net) has
[a great blog post](https://www.alexedwards.net/blog/using-go-run-to-manage-tool-dependencies)
on using this if you want to read more about it for general Go tool
management.

In the same way as before, we wrap the invocation in a shell script:

```bash
#!/usr/bin/env bash

exec go run google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.2.0
```

An important difference between this method of version management and the one
used for `protoc-gen-go` and `protoc-gen-grpc-gateway` is that it doesn't add
this tool to our dependency closure. This makes it perfect for running any
Go-based tools, since we avoid all of the problems with tool dependencies,
while getting most of the benefits.

## Generating using our new plugins

To use our shell script wrappers with something like `buf` (assuming you put
the wrappers in `./bin/protoc-gen-xxx`), use a
`buf.gen.yaml` similar to this:

```yaml
version: v1
plugins:
  - name: go
    out: gen/go
    path: bin/protoc-gen-go
    opt:
      - paths=source_relative
  - name: go-grpc
    out: gen/go
    path: bin/protoc-gen-go-grpc
    opt:
      - paths=source_relative
  - name: grpc-gateway
    out: gen/go
    path: bin/protoc-gen-grpc-gateway
    opt:
      - paths=source_relative
```

And run

```shell
$ buf generate
```

This explicitly tells `buf` what executable to invoke for each plugin. An
alternative to this is to temporarily override your `$PATH`, like so:

```$
PATH=$(pwd)/bin/:$PATH buf generate
```

I prefer the explicit path definitions, which makes it easier for others to see
what is happening.

If you prefer using `protoc`, it would look like this:

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

//go:generate go run github.com/bufbuild/buf/cmd/buf@v1.9.0 generate
```

That means the only thing we have to run to download `buf` and all the plugins
we use is:

```shell
$ go generate ./...
```

How neat is that?

## Conclusion

We've learned why Go Protobuf plugin management is important, and explored a
few of the most common solutions people use today. We've also introduced a
novel way of managing these plugins that minimizes the problems and avoids
having to use a separate installation step completely.

See the
[example repo](https://github.com/johanbrandhorst/go-protobuf-plugin-versioning-example)
for a complete example of using this method for managing your Go Protobuf
plugin versions.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
