---
date: 2017-08-04
subtitle: "Using docker-compose with CircleCI"
tags: ["docker", "circleci", "docker-compose", "github"]
title: Advanced CircleCI docker testing
---

In a [recent blog post](/post/gopherjs-integration-tests) I talked about
automating the testing of an advanced GopherJS library using a combination
of QUnit, Ginkgo and Agouti. That allowed me to run a complete integration test
suite against my library by automatically spinning up browsers and pointing
them at my QUnit GopherJS page. This was a great start, but after running
it a couple of times we find that there are several problems:

1. It requires all browsers tested to be installed on the machine running the tests.
This limits the scale of testing as no-one is going to be running around with Chrome,
Firefox, Safari, Edge and whatever other browser we may want to test with. Especially
not different versions of said browsers!
1. It's _still_ a manual step. Wouldn't it be great if these tests could be run on every
pull request and every push to the master branch?

## Enter CircleCI

To solve these problems I spent some time figuring out how to use the
[CircleCI platform](https://circleci.com/) to automate my setup.
I knew it wouldn't be trivial as there are many different dependencies
in the different parts of the
[protobuf repository](https://github.com/johanbrandhorst/protobuf).
Building the GopherJS protoc plugin requires Go. Generating
the well known types requires protoc and the GopherJS protoc plugin to both be installed.
The integration tests require Firefox and Chrome to be installed on the machine running the tests.

Fortunately [CircleCI 2.0](https://circleci.com/docs/2.0/) embraces Docker
as a testing sandbox. At work we use GitLab whose CI solution is similarly
centered around docker (though not exclusively!), so I was reasonable well versed
in the quirks around using Docker in CI. The layout of the CircleCI configuration is
quite different from the one used by GitLab, so it took me a while to get up to speed.

## The integration test

In order to fix the issues I mentioned at the start of this post, I decided to rewrite
my tests to be runnable in docker containers, with the browsers running in separate
containers. As such, I wrote a `docker-compose` file to define the setup required.
Here's the docker-compose file I used:

```yaml
version: '2'
networks:
    internal:
        driver: bridge
services:
    chromedriver:
        environment:
            CHROMEDRIVER_WHITELISTED_IPS: ""
        expose:
            - "4444"
        image: robcherry/docker-chromedriver:latest
        networks:
            - internal
        privileged: true
    selenium:
        expose:
            - "4444"
        image: selenium/standalone-firefox:latest
        networks:
            - internal
    testrunner:
        # This just sleeps, we execute the test command using docker-compose exec.
        container_name: testrunner
        command: sleep infinity
        depends_on:
            - chromedriver
            - selenium
        environment:
            CHROMEDRIVER_ADDR: chromedriver:4444
            SELENIUM_ADDR: selenium:4444
            GOPHERJS_SERVER_ADDR: testrunner:8080
        expose:
            - "8080"
            - "9090"
            - "9095"
            - "9100"
            - "9105"
        image: golang:latest
        networks:
            - internal
```

It starts a ChromeDriver, a Selenium and a standard Go container.
This is easy enough to run on your own machine, with `docker-compose up`
and `docker-compose exec`. I wish I could use `docker-compose run` here, but because of
[an old bug that seems to have been forgotten](https://github.com/docker/compose/issues/4052),
we're forced to use `up` and `exec`. This is how we run this:

```bash
bash -c "\
    set -x \
    trap '\
        docker-compose logs selenium && \
        docker-compose logs chromedriver && \
        docker-compose down' EXIT; \
    docker-compose up -d && \
    docker-compose exec -T testrunner bash -c '\
        mkdir -p /go/src/github.com/johanbrandhorst/protobuf/' && \
    docker cp ./ testrunner:/go/src/github.com/johanbrandhorst/protobuf/ && \
    docker-compose exec -T testrunner bash -c '\
        cd /go/src/github.com/johanbrandhorst/protobuf && \
        go install ./vendor/github.com/onsi/ginkgo/ginkgo && \
        cd test && make test' \
    "
```

Let me preface this by saying that I know this looks absolutely rubbish, but I really
wanted the trap and I also wanted this in a Makefile so I could run it easily
from my terminal, and I also did _not_ want to have to write a separate shell script for it.
This works, and if you squint and ignore
the backslashes and ampersands you can kind of see what I was going for.

Something worth noting here is the use of `docker cp` to get the contents of the repository
into the testrunner container. This is a workaround to a well known shortcoming of
running docker containers from other docker containers, namely that
**you can't volume mount from one docker container to another one**.

So now that we've got a docker-compose file and a hacky bash line to run it, what is
required to get it running on CircleCI? Look no further:

```yaml
tests:
    docker:
        - image: ypereirareis/docker-compose
    working_directory: /go/src/github.com/johanbrandhorst/protobuf
    steps:
        - checkout
        - setup_remote_docker
        - run:
            name: Browser Integration Tests
            command: make integration
```

We use `ypereirareis/docker-compose` which just comes with `docker-compose` pre-installed.
The magic here is using `setup_remote_docker` to do just that. This is required to get
access to docker powers from within your CircleCI containers.
The `checkout` job tells CircleCI that we want the git repo cloned into the
`working_directory`.

Bam! Just like that we've got our GopherJS integration tests up and running on CircleCI!
The coolest thing here is that now in the future if we want to test other versions of
browsers, or other browsers altogether, we need only add another docker container to the
fray.

## Summary

We've shown that you can run complex testing scenarios involving several interdependent
docker containers on CircleCI. These tests run automatically on PRs and commits made to the
repository to preserve confidence in the functionality of the code. You can check out
the CI in action on my [github repo](https://github.com/johanbrandhorst/protobuf).

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!

