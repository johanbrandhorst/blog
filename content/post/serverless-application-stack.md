---
title: "Serverless Application Stack"
subtitle: "Using GCP Cloud Run and CockroachDB Serverless"
date: 2021-11-20
tags: ["cockroachdb", "postgres", "deployment", "go"]
---

The dream of a serverless, general-purpose, portable application stack
is finally a reality. TL;DR: deploy your application to
[GCP Cloud Run](https://cloud.google.com/run) with a
[CockroachDB Serverless](https://www.cockroachlabs.com/blog/announcing-cockroachdb-serverless/)
instance for persistence. Read on for a deeper dive.

# Serverless compute

AWS Lambda revolutionized the industry by introducing the concept of
"serverless" computing to the masses. Today it lets devs and companies
alike pay for exactly the amount of compute they need, down to the millisecond
it takes to execute the code. A generous free tier lets independent
developers experiment with and build small projects around it. But it's
not without its problems:

* Unusual packaging format

  Lambda deploys using the AWS CLI, in a custom packaging format, which
  can make it hard to understand how everything gets executed, and easy
  to make mistakes in configuration that aren't discovered until after
  deployment.

* Vendor lock in

  Becoming dependent on Lambda makes it hard to move to a different
  provider, should AWS decide to change their terms or prices. The custom
  packaging format increases the work required to migrate off Lambda.

* Hard to test locally

  The environments in which Lambda's are executed are not reproducible
  locally, so getting confidence in your code often requires deploying it.

These, among others, make me hesitant to use Lambda for hobby projects or
small business projects. Fortunately, the industry has been practically
flooded with options since Lambda was first released, and nowadays there
are solutions that revolve around containers as a packaging format, which
removes most of the concerns. In this post, we're going to examine one
such solution: [Google Cloud Platform Cloud Run](https://cloud.google.com/run).

## GCP Cloud Run

Cloud run uses the container as the application packaging format, fixing most
of the issues with AWS Lambda:

* A widely used, open standard
* Portable to numerous different orchestration solutions
* Easy to run and test locally
* Full HTTP/2 and gRPC support

Cloud Run is built on [Knative](https://knative.dev), a serverless deployment
framework you can run on your own, or as a service, as in this case. As a lone
dev mostly interested in building hobby projects, it is good to know that
I _can_ get off GCP if I want to, but I'm mostly interested in the PaaS
offering to start with.

A serverless compute platform alone is not enough for our serverless
application stack though. Long the issue with running serverless dev projects
has been, where do we persist the data?

# Serverless persistence

Serverless persistence has been the area with the biggest new product launches
in recent years. Solutions such as
[AWS Aurora Serverless](https://aws.amazon.com/rds/aurora/serverless/),
[PlanetScale](https://planetscale.com/) and [Cloudflare Workers
Durable Objects](https://blog.cloudflare.com/introducing-workers-durable-objects/)
have made serverless persistence readily available to devs, but they all include
compromises that make them unsuitable for me:

* AWS Aurora (as of writing this) only supports MySQL, and as far as I can tell does not include a free tier
* PlanetScale also only supports MySQL, and I admit I'm weary of using a database
  [without support for foreign key constraints](https://docs.planetscale.com/tutorials/operating-without-foreign-keys)
* Cloudflare Workers have the same lock-in problems as AWS Lambda, and require a
  new way of thinking about state since it's not a database

If you've read any of [my other posts](/post/postgres), you'll know that I'm a fan of
[PostgreSQL](https://postgresql.org/). Fortunately, a recent product launch ticks
all the boxes for me:
[CockroachDB Serverless](https://www.cockroachlabs.com/blog/announcing-cockroachdb-serverless/).

## CockroachDB Serverless

[CockroachDB](https://www.cockroachlabs.com/) has long been the answer to the question;
how do I run a relational database workload in a cloud native environment? Often this
would not be the question you're asking yourself if you're a dev wanting to try out
some new project, so CockroachDB was not that interesting. With their latest offering
though, that all changes. It suddenly goes from irrelevant to the most promising solution
of all:

- PostgreSQL Compatibility
- A generous free-forever tier
- Automatic redundancy
- No database administration
- Explicit spending limits

That last point is very interesting, and sets it apart from the competition. You can ensure
that you don't end up with any surprise bills if you
[accidentally end up calling your database recursively](https://blog.tomilkieway.com/72k-1/).
As a dev working on toy projects, this is very comforting and confidence inducing.
Well done Cockroach Labs!

> If you're interested in learning more about how Cockroach Labs built their serverless
offering, they wrote a
[very interesting blog post](https://www.cockroachlabs.com/blog/how-we-built-cockroachdb-serverless/)
about it!

Now lets take this application stack for a spin!

# Example deployment

To test this deployment stack, I'm going to run my
[grpc-postgres project](https://github.com/johanbrandhorst/grpc-postgres) on Cloud Run,
connecting to a CockroachDB Serverless database cluster, and fire off some requests.
Lets get started!

## Create the CockroachDB Serverless cluster

The Cockroach docs have a helpful
[quickstart doc](https://www.cockroachlabs.com/docs/cockroachcloud/quickstart.html).
I signed in with my Github account and created a new "cluster" on GCP in Iowa (us-central1).
As I plan on using Cloud Run, I figured it will probably work best if the database is
deployed to the same cloud provider as the compute code. I was assigned the name
`merry-possum`, which is cute, but not quite
[Tailscale tails and scales](https://twitter.com/Catzkorn/status/1440794293183004673)
levels of dedication to the cause. Make sure to set the spending limit to $0 to
avoid surprise fees!

The next step is to download the CA certificate used to establish the TLS connection
with the database:

```shell
$ curl -o root.crt -O https://cockroachlabs.cloud/clusters/2cee3827-0baf-4cb1-ac86-4e30fb9d550d/cert
```

We'll need to use this certificate when creating our container and make sure it's available
to our application when connecting to the database. We could theoretically run our application
without verifying the certificate of the server we're connecting to, but you almost certainly
don't want to do that, since it means you can't be sure who you're talking to! Using the
certificate provided by Cockroach via their cluster web UI, we can be sure that
we're talking to the right database.

We also need to take careful note of the password. As this is the only thing that prevents other
users from connecting to your database, make sure to keep it secret! Ideally it doesn't need to
be written down anywhere other than in the GCP secrets management. My application uses
a URL to configure all the Postgres connection parameters, and the CockroachDB cluster web UI helpfully provides a
connection URL. Since the URL contains your password, the whole thing should be considered a
secret, and treated as such. Here's what my string looks like (user and password redacted):

```
postgresql://AzureDiamond:hunter2@free-tier.gcp-us-central1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full&sslrootcert=$HOME/.postgresql/root.crt&options=--cluster%3Dmerry-possum-4942
```

There are a few things to note about the connection string provided.

* It includes the path to the root certificate, so if we want to change where we put the certificate,
  we'll need to change the connection string. I plan on putting the certificate in `/root.cert`, so
  I updated this part of the query.
* It uses a query parameter option I haven't seen before: `options=--cluster%3Dmerry-possum-4942`. This
  is likely some way to route traffic on this host and port to my specific instance handler.

> To learn more about the formatting of Postgres URLs, see
  [their documentation](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING).

Our updated connection string looks like this:

```
postgresql://AzureDiamond:hunter2@free-tier.gcp-us-central1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full&sslrootcert=/root.crt&options=--cluster%3Dmerry-possum-4942
```

## Set up the GCP project

To isolate all the resources of my projects, I like to create a separate project each time.
This time, I named my project `serverless-application-stack`, but you can of course name your
project whatever you like.

## Set up a billing alert on the project

GCP doesn't make it nearly as easy to limit the amount of money spent unfortunately, so it's
a good idea to set up a billing alert. I have an alert set for when my spend approaches 50% of $1.

## Create and authenticate with GCP Artifact Registry

In order to deploy our application to Cloud Run, we need to publish the image to the
[GCP Container Registry](https://cloud.google.com/container-registry) or the newer
[GCP Artifact Registry](https://cloud.google.com/artifact-registry). GCP nowadays recommends
users use the artifact registry, so that's what we're going to use today. This limitation
is probably the single most annoying part of using Cloud Run, as I'd much prefer to use my
own registry, like the one provided by Github, or the official Docker registry.

Create a new GCP Artifact Registry repository via
https://console.cloud.google.com/artifacts/create-repo?project=serverless-application-stack.
Change the project to match the name of the project you created. I named my repository
`grpc-postgres` to match the name of my application. The format should be `Docker`.

Download and install the `gcloud` tool via your preferred
[installation method](https://cloud.google.com/sdk/docs/install), if you don't already have it.

Login to the `gcloud` CLI with `gcloud auth login` and authenticate your local `docker` CLI
to push to your new repository. This is what it looks like for me, but it may differ depending
on your location:

```shell
$ gcloud auth configure-docker us-central1-docker.pkg.dev
```

## Create the Docker image

I already [publish](https://github.com/johanbrandhorst/grpc-postgres/actions/workflows/publish.yaml)
my application Docker images automatically using [ko](https://github.com/google/ko), so we will
use that as a base for the new image. The only thing we need to add is the certificate we
downloaded earlier, so that we can trust the connection to the database. Our Dockerfile looks like this:

```Dockerfile
FROM ghcr.io/johanbrandhorst/grpc-postgres/grpc-postgres-a2daed418a2fcb26a6928e09d27921e3@sha256:dd6707d9153257b447977f01623510637156ee8726afa3352e8f324028bf8ca0

COPY ./root.crt /root.crt
```

Note that we put the CA certificate in `/root.crt`, to match the connection string change we made.

Ensuring we have downloaded our cert as `./root.crt`, we can build and push the image
in one command using `docker buildx`:

```shell
$ docker buildx build -t us-central1-docker.pkg.dev/serverless-application-stack/grpc-postgres/app --push .
[+] Building 3.6s (8/8) FINISHED
 => [internal] load build definition from Dockerfile                  0.1s
 => => transferring dockerfile: 228B                                  0.0s
 => [internal] load .dockerignore                                     0.2s
 => => transferring context: 2B                                       0.0s
 => [internal] load metadata for ghcr.io/johanbrandhorst/grpc-postgr  0.0s
 => [internal] load build context                                     0.1s
 => => transferring context: 2.77kB                                   0.0s
 => [1/2] FROM ghcr.io/johanbrandhorst/grpc-postgres/grpc-postgres-a  0.0s
 => CACHED [2/2] COPY ./root.crt /root.crt                            0.0s
 => exporting to image                                                0.0s
 => => exporting layers                                               0.0s
 => => writing image sha256:763a9507c89ff442493132133741eb183369ec6d  0.0s
 => => naming to us-central1-docker.pkg.dev/serverless-application-s  0.0s
 => pushing us-central1-docker.pkg.dev/serverless-application-stack/  3.1s
 => => pushing layer 0a22afd81131                                     1.5s
 => => pushing layer f5e7402ea96e                                     1.5s
 => => pushing layer ffe56a1c5f38                                     1.5s
 => => pushing layer 6d75f23be3dd                                     1.5s
```

## Test your application locally

Now that we've got an image built, we can test running it locally, to make sure it works as we expect:

```shell
$ docker run \
    -e POSTGRES_URL=cockroachdb://AzureDiamond:hunter2@free-tier.gcp-us-central1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full&sslrootcert=/root.crt&options=--cluster%3Dmerry-possum-4942 \
    us-central1-docker.pkg.dev/serverless-application-stack/grpc-postgres/app
```

Note that for my application to work with CockroachDB, I've had to change the scheme to
`cockroachdb`. This may not be necessary for your application.

## Create the secret in GCP Secret Manager

As discussed, since the URL we're using to connect to the serverless database
contains our password, the whole thing should be considered a secret.
Create a new secret via https://console.cloud.google.com/security/secret-manager/create?project=serverless-application-stack
(adjust for your GCP project name). Paste in the Postgres URL in the secret value entry.

I named my secret `postgres-url`.

## Create the Cloud Run service

Now that we've got our application image, our database, and our database URL secret
set up, we can finally create the Cloud Run service:
https://console.cloud.google.com/run/create?project=serverless-application-stack.

Select the application image we just uploaded when prompted. You may need to navigate
to the Artifact Registry tab to find it.

I named my service `grpc-postgres` and deployed it to the Iowa (us-central1) region.
This is the same region as my database is deployed, so it should minimize access latency.

I tuned down the maximum number of instances from 100 to 3, to prevent nasty bill surprises.
We're only playing around here, so no need for infinite scaling.

Under `Advanced settings`, I've reduce the memory capacity to 128MiB, since Go is generally
pretty good at keeping memory use down, and we shouldn't be buffering a lot of data.

Under `Variables & Secrets`, make sure to configure your service to use the
`postgres-url` secret we created before. My application looks for the Postgres URL
under the environment variable `POSTGRES_URL`, so I will mount the secret as an
environment variable with that key name.

> Under `Connections`, I tried enabling HTTP/2 connections for this service, since my
  application is both a HTTP and gRPC server, but it seemed to break my HTTP server, so I left
  it disabled in the end.

Next, we configure this service to `Allow all traffic` and `Allow unauthenticated invocations`.
I want this service to be publicly available so that users can play around with it, but this
may differ depending on your needs, of course.

Proceed to create the service by following the wizard.

## End result

That's it! Once the service has been created, you'll be allocated a URL where your
application can be accessed.

![Deployed application](/img/cloud-run.png "Deployed Application")

I also went and tested gRPC unary and server side streaming with
[my script](https://github.com/johanbrandhorst/grpc-postgres/blob/master/cmd/main.go)
and it seemed to work just fine, which is pretty cool!

```
$ go run ./cmd/main.go --addr=grpc-postgres-<redacted>.run.app:443
INFO[2021-11-20] Read user                                     name=Johan role=ADMIN
INFO[2021-11-20] Read user                                     name=Alice role=GUEST
INFO[2021-11-20] Read user                                     name=Bob role=GUEST
INFO[2021-11-20] Read user                                     name=Charles role=GUEST
INFO[2021-11-20] Finished
```

## Wrapping up

We've introduced and deployed a scale-from-zero-to-infinity serverless general purpose
application stack with persistence. I will probably be sure to use this method for any
new experiments I want to try out and share with people.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
