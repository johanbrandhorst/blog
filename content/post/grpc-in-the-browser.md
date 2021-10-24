---
title: "gRPC-Web vs the gRPC-Gateway"
subtitle: "What's the difference between these technologies?"
tags: ["gRPC", "gRPC-Web", "gRPC-Gateway"]
date: 2021-10-24
draft: true
---

Ever since I first started using gRPC in 2016, I've been interested in learning
how to use it well with browser clients. It's a common question to ask once
you've decided that you are going to use gRPC for service-to-service
and mobile app communication. Here's this great technology that abstracts away
the problems I was having when making RPC calls between my services. How do I
use it for my front-end applications?

Once the question is asked, you might find that
[it's (still!) not possible to use raw gRPC in the browser](/post/state-of-grpcweb/#the-grpc-web-spec)
and that there are at least two different solutions for translating gRPC into
something a front-end application can use,
[gRPC-Web](https://github.com/grpc/grpc-web)
and the [gRPC-Gateway](https://github.com/grpc-ecosystem/grpc-gateway).

## The gRPC-Gateway

The gRPC-Gateway project started out (as I hear it) after the original author,
[Yuki Yugui Sonoda](https://github.com/yugui), left Google and wanted to use a
tool they had been using internally at Google, but couldn't find an open source
version. So they wrote one!

At its core the gRPC-Gateway is a translation layer between the HTTP/JSON
REStful API paradigm and the gRPC/Protobuf API paradigm. So what does that
mean? Lets start by talking about HTTP/JSON.

### HTTP/JSON APIs

What I like to call HTTP/JSON is the design pattern of using a
[RESTful API](https://en.wikipedia.org/wiki/Representational_state_transfer#Applied_to_web_services)
design for web service APIs. Examples of APIs like this include
[the Github REST API](https://docs.github.com/en/rest/overview) and
[the Stripe API](https://stripe.com/docs/api). I usually try to avoid calling
these "REST APIs" because there's nothing about a
[REST API design](https://en.wikipedia.org/wiki/Representational_state_transfer#Architectural_concepts)
that mandates the HTTP/JSON format, and often a gRPC API can and should be
designed with the REST concepts in mind.

A typical HTTP/JSON API call might be described as a simple HTTP GET request
with a JSON response body:

```
GET /api/v1/pokemon/snorlax
{
  "name": "snorlax"
}
```

This is an example of a HTTP/JSON API call to an API exposing information about
Pokémon. The general form of this API call might look like this:

```
GET /api/v1/pokemon/{name}
```

It might also expose the ability to create Pokémon through a POST endpoint with
a JSON request body:

```
POST /api/v1/pokemon
{
  "name":"blastoise"
}
```

Using the HTTP verbs `GET`, `POST`, `PATCH`, `PUT` and `DELETE` and designing
around resources (such as Pokémon in this exampe) are tell-tale signs of an
HTTP/JSON API.

### gRPC/Protobuf APIs

In contrast to HTTP/JSON APIs, gRPC/Protobuf APIs do not make use of any HTTP
verbs, since that's all handled by gRPC. It also doesn't use JSON, instead
opting for Protobuf as the transport encoding. Except for these differences,
it is often quite simple to map HTTP/JSON endpoints to gRPC/Protobuf. It is
still possible (and indeed often recommended) to keep REST API concepts in
mind when designing your gRPC APIs. The
[Google API design guide](https://cloud.google.com/apis/design) recommends
a [Resource Oriented Design](https://cloud.google.com/apis/design/resources)
greatly inspired by the REST API principles.

### Mapping HTTP/JSON to gRPC/Protobuf

Given that the differences between the two paradigms are not so great,
shouldn't it be possible to automate a mapping from one to the other?
That's exactly the role of the gRPC-Gateway. It does this by parsing
Protobuf RPC annotations according to the
[`google.api.http` spec](https://github.com/googleapis/googleapis/blob/974ad5bdfc9ba768db16b3eda2850aadd8c10a2c/google/api/http.proto#L44-L312).

For example, if you start out with a `GetPokemon` RPC like this:

```
rpc GetPokemon(GetPokemonRequest) returns (GetPokemonResponse) {};
```

You can add some `google.api.http` annotations to turn it into a HTTP/JSON API:

```
rpc GetPokemon(GetPokemonRequest) returns (GetPokemonResponse) {
  (google.api.http) = {
    get: "/api/v1/pokemon/{name}"
  }
};
```

That's it! The gRPC-Gateway generator generates a file that you run to take
care of the translation, and as a result, you can use your gRPC server with a
browser client without any problems. The gRPC-Gateway project also includes
[an OpenAPIv2 generator](https://github.com/grpc-ecosystem/grpc-gateway/tree/master/protoc-gen-openapiv2)
which can be used to generate an OpenAPIv2 (AKA swagger) file, which you can
use to generate a number of different clients (including browser clients).

For more information about the gRPC-Gateway, check out the
[project docs](https://grpc-ecosystem.github.io/grpc-gateway).

## gRPC-Web

[The gRPC-Web project](https://github.com/grpc/grpc-web) is the official
answer from [the gRPC project](https://grpc.io) to the question of using gRPC
in the browser. Like the gRPC-Gateway, it requires you to run a translation
layer between your gRPC service and the browser. Unlike the gRPC-Gateway,
it doesn't allow you to configure anything about that translation. Instead,
it defines
[a spec](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md) for how
the translation should happen. There are a number of different
implementations of this spec, in different languages, allowing users to find
the one that is the most suitable for their particular use case.

My preferred option is to use the [Envoy proxy](https://www.envoyproxy.io/) if
I'm running in Kubernetes, or the
[Improbable gRPC-Web proxy](https://github.com/improbable-eng/grpc-web/tree/master/go/grpcwebproxy)
as an in-process Go proxy, if I'm not.

The project includes a generator that can produce both pure JS and TS code,
which can make the experience of using it very similar to that of using gRPC in
the back-end. Note that the TypeScript code generated by the library is pretty
poor, and
[vastly superior third party implementations](https://github.com/timostamm/protobuf-ts)
are available, should you want to use gRPC-Web with TypeScript.

If you want to learn more about gRPC-Web, check out the
[project website](https://github.com/grpc/grpc-web).

## Which one should you use?

Though these both sound like similar projects from a distance, they're actually
built for two different use cases. Here's a quick guide to choosing:

* Do you want to expose a RESTful HTTP/JSON API?
  - Use the gRPC-Gateway
* Do you want to use gRPC with a browser client?
  - Use gRPC-Web

If you want to do both of the above, you can use the gRPC-Gateway to solve both
problems, but the browser client will be worse, since it either has to be
manually created, or generated via the OpenAPIv2 generator.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
