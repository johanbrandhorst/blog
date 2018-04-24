---
title: "Advanced gRPC Error Usage"
date: 2018-03-19
subtitle: "Best practices for error metadata propagation with gRPC"
tags: ["golang", "gRPC"]
---

How to best handle errors in Go is a divisive issue, leading
to opinion pieces by illustruous bloggers such as
[Dave Cheney](https://dave.cheney.net/tag/error-handling),
the commander himself
[Rob Pike](https://commandcenter.blogspot.co.uk/2017/12/error-handling-in-upspin.html)
as well as the
[official Go blog](https://blog.golang.org/errors-are-values). I'm
not going to tackle those opinions here, instead I'm going to talk
about best practices for errors when using gRPC and Go.

### The gRPC Status package

The Go gRPC implementation has a
[`status` package](https://godoc.org/google.golang.org/grpc/status)
which exposes a nice simple interface for creating rich gRPC errors.

For example, lets say you have a method that takes an ID as a parameter,
but the requested ID did not exist in your store. You could just return
the error your store backend returned, but a good gRPC server should
make use of the gRPC error codes. In this case, `codes.NotFound` is
the appropriate code.

```go
err := status.Error(codes.NotFound, "id was not found")
return nil, err
```

To find which code you should be returning when, make sure to read
[the extensive documentation for the grpc/codes package](https://godoc.org/google.golang.org/grpc/codes).
These errors translate the code and message to the `grpc-message`
and `grpc-status` trailers respectively in the
[gRPC HTTP2 protocol spec](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#responses).

Extracting the message and code in a gRPC client is also done through the
`status` package, with the [`Status.FromError`](https://godoc.org/google.golang.org/grpc/status#FromError).

```go
st, ok := status.FromError(err)
if !ok {
    // Error was not a status error
}
// Use st.Message() and st.Code()
```

The Go gRPC implementation [guarantees](https://github.com/grpc/grpc-go/pull/1782)
that all errors returned from RPC calls are `status` type errors. Because of this,
you can usually use the
[`status.Convert`](https://godoc.org/google.golang.org/grpc/status#Convert) method instead.

### Advanced usage

The `status` package also comes with the power to attach _arbitrary_
protobuf metadata to your errors, courtesy of the protobuf `Any` message type
and the [`Status.WithDetails`](https://godoc.org/google.golang.org/grpc/status#Status.WithDetails)
method.

For example, if a request is provided with a parameter that is incorrect regardless
of the state of the system, you may want to return more information about which
field caused the error and why. You could stuff all of this into the error message,
but it is not meant for long messages. Here's an example of using the
[`errdetails` package](https://godoc.org/google.golang.org/genproto/googleapis/rpc/errdetails)
to attach extra error metadata to an error:

```go
st := status.New(codes.InvalidArgument, "invalid username")
desc := "The username must only contain alphanumeric characters"
v := &errdetails.BadRequest_FieldViolation{
    Field: "username",
    Description: desc,
}
br := &errdetails.BadRequest{}
br.FieldViolations = append(br.FieldViolations, v)
st, err := st.WithDetails(br)
if err != nil {
    // If this errored, it will always error
    // here, so better panic so we can figure
    // out why than have this silently passing.
    panic(fmt.Sprintf("Unexpected error attaching metadata: %v", err))
}
return st.Err()
```

In order to extract these errors on the other side, for printing a nicely
formatted error message to the user for example, you can use the
[`status.Details`](https://godoc.org/google.golang.org/grpc/status#Status.Details) method:

```go
st := status.Convert(err)
for _, detail := range st.Details() {
    switch t := detail.(type) {
    case *errdetails.BadRequest:
        fmt.Println("Oops! Your request was rejected by the server.")
        for _, violation := range t.GetFieldViolations() {
            fmt.Printf("The %q field was wrong:\n", violation.GetField())
            fmt.Printf("\t%s\n", violation.GetDescription())
        }
    }
}
```

### Note about using GoGo Protobuf with status

#### UPDATE

TL:DR; `gogo/googleapis` types work with `grpc/status`.

While investigating [another issue](https://github.com/gogo/grpc-example/issues/9)
relating to `gogo/protobuf` and the `grpc-gateway`, github user
[@glerchundi](https://github.com/glerchundi)
[pointed out](https://github.com/grpc-ecosystem/grpc-gateway/pull/529#issuecomment-376822766)
that `gogo/protobuf` types could potentially circumvent issues with
`golang/protobuf/ptypes` referring to its own registry by implementing
`XXX_MessageName() string` on its types. This turned out to fix all compatibility
issues with `grpc/status`, so `gogo/protobuf` was quickly updated
to support this function in `gogo/protobuf/types` and `gogo/googleapis`.
As a result of this, `gogo/googleapis` types now work transparently with `grpc/status`.

[`gogo/status`](https://github.com/gogo/status) is still necessary if you want to
use types that only register with `gogo/protobuf` and don't make use of either
the `goproto_registration` or `messagename` extensions GoGo Protobuf extensions.

I've preserved the old advice here, but it no longer applies. The
[`gogo/grpc-example` repo](https://github.com/gogo/grpc-example) has been updated
to make use of `grpc/status` again.

> I mentioned above that the `status` package uses the `Any` protobuf
message type under the hood. This, combined with the `Status.WithDetails`
and `Status.Details` methods [using the `golang/protobuf/ptypes`](https://github.com/grpc/grpc-go/blob/738eb6b62fe9a30ddfe19934b0a22b1a66fbb661/status/status.go#L162)
directly causes it to be generally
[incompatible with `gogo/protobuf` messages](https://github.com/grpc/grpc-go/issues/1885).
One workaround for this is to register your error metadata messages with
`golang/protobuf` through the [`goproto_registration` extension](https://github.com/gogo/protobuf/blob/master/extensions.md#goprotobuf-compatibility).
This will work for your own types, but what if you don't have control
over the extensions used? What if you want to use types from
`gogo/googleapis` as I suggested in [my post on `gogo/protobuf` compatibility](/post/gogoproto)?

> To help with this issue, [I submitted a PR](https://github.com/grpc/grpc-go/pull/1927)
to the Go gRPC project to allow the creation of `status.Status` types from
arbitrary error types that implement a specific interface. This, in combination
with the new [`gogo/status` package](https://github.com/gogo/status) allows
the user the same simple `status` interface that works with arbitrary
`gogo/protobuf` registered message types.

> For an example of this in use, please check out the
[`gogo/grpc-example` repo](https://github.com/gogo/grpc-example),
which was created to showcase this and other solutions when using `gogo/protobuf`,
especially together with the gRPC-Gateway. Please ensure you use gRPC Go
[v1.11.0](https://github.com/grpc/grpc-go/releases/tag/v1.11.0)
or greater to make use of the `gogo/status` package.

### Further reading

The [Google API Design Guide](https://cloud.google.com/apis/design)
has [a section on errors](https://cloud.google.com/apis/design/errors)
with a thorough discussion of the Status Protobuf type which I encourage you to
read if you want to learn more about general protobuf API error handling.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!

