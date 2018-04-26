---
date: 2017-06-04
subtitle: "Or how I learned to love Docker Cloud and Scaleway"
tags: ["deployment", "devops", "docker", "scaleway"]
title: Auto-deployment of your app from Github
---

## Update
Docker Cloud is [being discontinued](http://success.docker.com/article/cloud-migration).
For an alternative easy app deployment, check my new post
on [automatic app deployment](/redeploy). Furthermore,
I would nowadays recommend [Hetzner Cloud](https://www.hetzner.com/)
over Scaleway. Scaleway was running out of instances
last time I tried using them, and Hetzner's web console
is much better than Scaleways.

Old post preserved below.
## Introduction
Yesterday (!) I asked in the Gophers slack for recommendations for deployment
of static Go binaries, as I was in the process of deploying a demo for another
blog post I'm working on. I was told to check out [Scaleway](https://www.scaleway.com/)
among other things, and found it to be an excellent option for simple and cheap hosting.
It currently provides data centres in Paris and Amsterdam, which is perfect for me. I then found I could automatically
build and deploy docker images via
[Docker Cloud](https://cloud.docker.com/),
directly from GitHub. It was all so easy that I thought I'd
put together a quick walkthrough of the steps
I followed to get everything up and running.

## Spin up the server
Register with Scaleway, add your SSH public key
and start a `VC1S` server. We could
get fancy here and use an `ARM` backed server,
but I don't see the need so I
opted for the `x86` machine. 2 threads, 2GB memory, 50GB SSD
and it costs us `€2.99` per month _at most_,
or as little as `€0.006` per hour. The fee also
includes a public `IPv4` address. What a bargain!

Go for the `Docker` image listed under the `ImageHub` section,
as we'll need docker installed on the machine for later.

While the machine is spinning up it's time to set up our
Docker Cloud account.

## Docker Cloud
[Register or login](https://cloud.docker.com/) if
you already have a Docker hub account, and
navigate to `Cloud Settings`. You'll need to link your GitHub
(or Bitbucket) account here to enable auto-build and auto-redeployment
of images. The Docker side of this is entirely free of charge, you don't
even have to enter a credit card into your account, for that
ultimate peace of mind that there won't be any nasty surprises
down the line.

## Register the Scaleway node to Docker Cloud
Once registered, we need to add our Scaleway node as a Docker node.
First things first, Docker Cloud requires us to open a
couple of inbound ports, namely `2375/tcp`, `6783/tcp` and `6783/udp`.
While we're here, you probably want to add an inbound rule
for `443/tcp` (you do plan to serve your app over HTTPS, right?).

Once the security group has been configured, go back to Docker
Cloud and lick the `+` button in the top right and select
`Bring Your Own Node`. It'll give you a command that we need
to run on our Scaleway node, so now it's time to ssh onto
the Scaleway node.

```
ssh root@your-scaleway-node-ip
```

Once you've accepted the host key, proceed to run the snippet
from the Docker Cloud page. If everything works, your Docker Cloud
page should tell you that the node was successfully registered!

## Sidenote: Multi-stage Docker Builds
At this point I want to mention that this works particularly
well if you utilize multi-stage docker builds. They're a new
feature in Docker `17.05`, so ensure you've selected `17.05`
as the docker version in your Docker Cloud settings.
See this `Dockerfile` for an example:

```Docker
# Build
FROM golang AS build
ADD . /go/src/github.com/myrepo/myapp
ENV CGO_ENABLED=0
RUN cd /go/src/github.com/myrepo/myapp && go build -o /app

# Production
FROM scratch
COPY --from=build /app /app
EXPOSE 443
ENTRYPOINT ["/app"]
```

We use the [official golang image](https://hub.docker.com/_/golang/)
to build the application, then we just take the static
binary and stuff it into a minimal container environment.
Amazingly simple and you end up with a container not much
larger than the size of the binary itself. Truly we are
living in the future.

## Setting up the Docker Cloud repository
We've added Docker Cloud to our GitHub already, so now
we can go ahead and create a repository from GitHub. I'm assuming
you've already got your source repo on github so it should
just be a matter of clicking `Create` and selecting
the repository to link it to in the settings. It'll
automatically detect if there is a `Dockerfile` in the root
of your repository. Otherwise, just select the path to the
`Dockerfile`. Your new Docker Cloud repository will automatically be configured to build on new merges to master.

## Deploying the app
Go to the repository page we just created. See that alluring
`Launch Service` button in the top right? It's time to launch
our service! Click it and on the next page you'll get a new interface
allowing you to customize the forwarded ports, volumes, commands
and many other things. Most significantly, make sure to turn on
`AUTOREDEPLOY`. This will automatically redeploy your service
when a new one has been successfully built from your source.

Once you've tweaked the dials and dotted the i's, go ahead and
click `Create & Deploy`. It'll spin up your new container
on the Scaleway node we registered earlier. Magic!

## 🍾

Congratulations! You've now got your demo app running in a
Docker container on your Scaleway node, with automatic
redeployment triggered straight from your GitHub pushes.
Lean back in your chair and crack open a cold one, you deserve it!

If you liked this article, or you have anything you'd like to add
or correct, don't hesitate to reach out to me on twitter
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or on
Gophers Slack under `jbrandhorst`. Thanks for reading!
