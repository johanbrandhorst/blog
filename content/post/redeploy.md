---
title: "Replacing Docker Cloud"
date: 2018-04-24
subtitle: "Introducing Redeploy, automatic Docker Hub deployments"
tags: ["docker", "containers", "automation"]
---

## Introduction

Last year I wrote [a post](/app-deployment) about automating
deployment of your application, all the way from git push to
redeploying your application in your environment. It relied on
the free version of [Docker Cloud](https://cloud.docker.com),
which allowed the use of a single node for free. Of course,
the idea was that you should eventually want to scale your
deployment, and then you'd need to pay. As long as all you
needed was a single node, Docker Cloud and its
[Bring Your Own Host](https://docs.docker.com/docker-cloud/infrastructure/byoh/)
was powerful, flexible and simple. Life was good.

Unfortunately, cluster management in Docker Cloud is
[being discontinued](http://success.docker.com/article/cloud-migration).
I looked around for other solutions which fulfilled the same requirements.
Namely, I wanted something simple, flexible and _ideally_ free. It seems
most places nowadays encourages you to simply deploy Kubernetes. Now, I
really like the idea of using Kubernetes, but for my hobby projects it's
simply a bit overkill.

Having discarded any prebuilt solutions, I went back to Docker. Their
[migration guide](https://docs.docker.com/docker-cloud/migration/#what-changes)
mentions that the auto-redeploy feature can be emulated with the use of
[automated builds](https://docs.docker.com/docker-hub/builds/) and a
[webhook](https://docs.docker.com/docker-hub/webhooks/). I found
[docker-hook](https://github.com/schickling/docker-hook), which allows
the user to trigger scripts when a webhook is received. Now, this is a
good start, and for most users, it's probably good enough. However, to me
there were at least three problems with this solution:

1. Users have to manually write actions to perform.
1. It has [various](https://github.com/schickling/docker-hook/pull/17) [bugs](https://github.com/schickling/docker-hook/pull/18) in its implementation.
1. It doesn't easily allow itself to be used in a container.

So, I went and wrote a better solution.

## Introducing Redeploy

[Redeploy](https://github.com/johanbrandhorst/redeploy) is a small app that serves a single handler on a configurable endpoint.
This endpoint handles Docker webhooks, extracting information and
redeploying any configured containers according to their configuration.
Its configuration file format is the
[docker-compose v3](https://docs.docker.com/compose/compose-file/)
format. Lets look at an example:

```yaml
version: "3"
services:
    myservice:
        # This must match the repo you've configured
        # the webhook to be sent from.
        # Without a tag, latest is assumed
        image: mydockernamespace/myrepo
        ports:
            - "80:8080"
        restart: always
```

This configures webhooks from `mydockernamespace/myrepo` to
deploy a docker container with the name `myservice`,
port `80` proxied to `8080` and automatic restarts. It will
automatically remove existing containers with the same name.

Conveniently, `redeploy` itself can be run in a container:

```bash
$ docker run --rm -d \
    -v $(pwd)/services.yaml:/services.yaml \
    # Mount the docker socket to allow container control.
    # Alternatively, define $DOCKER_HOST to use a remote docker host.
    -v /var/run/docker.sock:/var/run/docker.sock \
    --name redeploy \
    -p 8555:8555 \
    jfbrandhorst/redeploy --config /services.yaml --path yourconfigureddockerhubpath
Serving on http://0.0.0.0:8555/yourconfigureddockerhubpath
```

The parameter `--path` should match the path you've configured your
Docker webhook for. This should be something unique in order to
prevent unauthorized users from restarting your containers!

## Conclusion

We've introduced `redeploy`, an app that makes it easy to redeploy
your containers automatically straight from a push to your github repo.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
