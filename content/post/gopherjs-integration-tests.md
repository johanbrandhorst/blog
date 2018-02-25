---
date: 2017-07-11
subtitle: "With friends Qunit, Ginkgo and Agouti"
tags: ["golang", "gopherjs", "testing", "agouti", "ginkgo", "qunit"]
title: GopherJS Integration Tests
---

Recently I found myself wondering how I was going to test my new
[GopherJS gRPC-Web bindings](https://jbrandhorst.com/post/gopherjs-grpcweb).
Writing tests was something I had been
waiting with until I had something working, mostly because I had
no idea how I was going to meaningfully test GopherJS code that
relies on interactions with JS and the reponses of a server.

I have in the past made a small contribution to the
[GopherJS websocket repo](https://github.com/gopherjs/websocket), and found myself
impressed with the extensive tests written for the repo.
It uses [QUnit](https://qunitjs.com/) and the [GopherJS QUnit bindings](github.com/rusco/qunit).
Unfortunately it appears it the bindings were written for QUnit 1.5,
which is quite old, but it does fine for a basic unit testing framework.

## The journey starts

I sat about writing some QUnit tests and found the experience pretty
spartan but good enough for my purposes. After writing some tests and
wiring up the GopherJS client to be hosted by my server, navigating
to the hosted page gives you a screen that looks like this:

![QUnit Results Page](/img/tests.jpg)

Yay all tests pass! We could leave it here and just tell ourselves that
we'll run the tests every time we add something, no problem. But I was
still not happy that this required a manual step every time we wanted
to verify the code. I wanted to find some way to automate the step
that is currently manual, that is, navigate to the page and check that
there are no errors.

## Enter Agouti

I've had dealings with various WebDrivers before, but I hadn't yet had
to solve the problem of parsing a web page in a Go context. I had seen
[Agouti](http://agouti.org/) in passing before when browsing the official
web page of the test framework we use at work - [Ginkgo](http://onsi.github.io/ginkgo/).
Here was a Ginkgo compatible test framework that could solve my problem!
I of course jumped at the chance to try it.

Working with Agouti is simple if you've ever used a WebDriver before,
all the usual `FindByX` are there, and it's also got cool Gomega matchers
like `HasText()` and `BeFound()`. All I needed to do was write the code
to open the browser to `https://localhost:10000` where my QUnit tests
were being hosted by the server, then do a little bit of parsing of the
page to find out whether any tests had failed, and then fail the Agouti
test based on that.

I also spent a little time on writing out the errors produced by QUnit
for a couple of different error types so that I would get a more helpful
message than just "Tests failed!" if there was a test failure.

I ended up with a test suite that starts the server hosting the GopherJS,
spins up a chrome browser window via `chromedriver`, navigates to the page,
grabs the JS rendered DOM content, parses parts of it to see whether any tests failed,
and reports the result. All now done via one single command.

<video src="/img/tests.webm" width="100%" preload="metadata" controls muted/>

Of course - the best part about this is that Agouti can be made to run with any
WebDriver compatible browser client, so Selenium, PhantomJS etc can be plugged in
in place of chromedriver. Free compatibility testing!

## Wrapping up

I've introduced the GopherJS QUnit bindings and Agouti, two packages that make
it a breeze to confidently test your GopherJS packages. The source for all this
is available [on my github](https://github.com/johanbrandhorst/protobuf/tree/master/test),
feel free to take a look!

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!
