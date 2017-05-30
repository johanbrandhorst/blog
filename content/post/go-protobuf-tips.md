+++
date = "2017-04-18"
title = "Go Protobuf Tips"
subtitle = "A couple of tips for working with proto files in golang"
tags = [ "golang", "protobuf", "grpc", "grpc-gateway" ]
+++

I've had my fair share of dealing with proto files in go (and to some extent JS),
so I thought I'd share some stuff I've learnt the hard way by working
with proto files.

## Protoc include paths
The `protoc` include paths can be pretty confusing, so I'll give a few examples
of how to use it properly.

#### Just include the current directory
`protoc` requires that the files referenced are in the include path, so if you're
referencing files relative to the current directory, you'll need to specify `-I.`,
which also means the `protoc` will resolve
all proto import paths relative to the current directory.

```bash
$ protoc myproto/myproto.proto -I. --go_out=:.
```

As long as your proto file imports are all relative to the current directory, this will work.

#### Several include paths
If you're using the [grpc-gateway](https://github.com/grpc-ecosystem/grpc-gateway)
you'll have to include the `google/api/annotations.proto` proto file.
The way I've always done that is by vendoring the proto files and adding the vendor path
as an include path:

```bash
$ protoc myproto/myproto.proto -I. -I./vendor/github.com/googleapis/googleapis/ --go_out=:.
```

Includes are specified in order of priority, so `protoc` will first see if
`./google/api/annotations.proto` exists, and if it doesn't, it'll check
`./vendor/github.com/googleapis/googleapis/google/api/annotations.proto`.

Note that vendoring is obviously a Go thing, so this might not chime well
with the other Devs in the office who want to keep the proto repository language agnostic.
In that case, you'll probably define some `third_party` folder where you can put
the external dependencies.

## Use the `go_package` option
This isn't something readily advertised in the
[introduction to protobuffers in Go](https://developers.google.com/protocol-buffers/docs/gotutorial)
or [Go gRPC quick start](http://www.grpc.io/docs/quickstart/go.html), but I find it
is essential if you ever want to import proto definitions from one proto file to another.

#### Raison d'être
For example, lets say we have `person.proto` in `person/person.proto`. It defines the
proto package `person` and the message `Person`.

```protobuf
syntax = "proto3";

package person;

message Person {
  string Name = 1;
  uint32 Age = 2;
}
```

We also have `team.proto` in `team/team.proto`, defining the proto package
`team` and the message `Team`. A `Team` consists of a sorted list of `Person`s,
so `team.proto` will need to import that definition from `person.proto`.

No problem, just add an `import person/person.proto` to `team.proto` and reference it
using the namespace specified by the `person.proto` package name:

```protobuf
syntax = "proto3";

package team;

import "person/person.proto"

message Team {
  repeated person.Person people = 1;
}
```

When we generate a go file from this definition using `protoc`, we'll end up with a Go file
that imports `person/person.pb.go`. That's no good!

Enter the `go_package` option.
#### Using the `go_package` option
For a proto file defined in `github.com/myuser/myprotos/myproto/myproto.proto` the
appropriate `go_option` value would be `github.com/myuser/myprotos/myproto`.
This means that the `protoc` compiler can generate a go file that will include the package
`github.com/myuser/myprotos/myproto` if you have another proto file that depends
on `myproto/myproto.proto`.

So let's fix the `person.proto` and `team.proto` proto files.

```protobuf
syntax = "proto3";

option go_package = "github.com/myuser/myprotos/person";

package person;

message Person {
  string Name = 1;
  uint32 Age = 2;
}
```

```protobuf
syntax = "proto3";

option go_package = "github.com/myuser/myprotos/team";

package team;

import "person/person.proto"

message Team {
  repeated person.Person members = 1;
}
```

Now, you might say we don't strictly _need_ to specify the `go_package` for `team.proto`,
since nothing imports it at the minute. I'd still suggest adding it to all the proto files
that you'll generate go code from so that in the future when a dependency might arise, you've
saved yourself, or even better, someone else, a whole lot of head scratching.

#### `protoc-gen-go` output paths with `go_package` option
One final note on the `go_package` option. Specifying it in your proto file means the
`protoc-gen-go` `protoc` plugin outputs your generated files as if the specified output directory is at the root of the `go_package` path. So... you'll probably want to slightly modify your `protoc` line:

```bash
protoc person/person.proto team/team.proto -I. --go_out=:$GOPATH/src
```

This should mean the files appear where you expect them to appear. Mind you make sure there
are no typos in the `go_package` option as it means the files will be generated in wrong place.

## `protoc` plugin parameters
Another thing I've learned through hours staring at my terminal in bewilderment is
how parameters are passed to `protoc` plugins. For example, the `protoc-gen-go` plugin
allows you to specify `plugin=grpc` as a parameter, and the `protoc-gen-grpc-gateway` takes
a boolean parameter `logtostderr=true`. I also think the `M` parameter is a `protoc`-wide way
to change the import path of a specific import as defined in a proto file. Parameters are
comma (`,`) separated. Parameter specification is delimited by the colon (`:`) character,
after which comes the desired output path.
The following are all valid `protoc` commands illustrating this:

```bash
$ protoc myproto/myproto.proto -I. --go_out=plugin=grpc:.
$ protoc myproto/myproto.proto -I. --grpc-gateway_out=logtostderr=true,Mgoogle/api/annotations.proto=myrepo/api/annotations.proto:.
```

## More
Feel free to reach out to me on gophers slack or on
[my twitter](https://twitter.com/JohanBrandhorst) if you found this helpful or if you have
any more tips I should include in this list.
