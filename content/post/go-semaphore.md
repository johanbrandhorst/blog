---
date: 2017-07-14
subtitle: "OOM errors hate this one weird trick"
tags: ["golang", "gRPC"]
title: Throttling resource intensive requests
---

Sometimes when you're writing a server, you've got a function
that consumes a lot of memory while running, or some other resource, and
you might be worrying that a sudden burst of requests could crash the server,
since gRPC by default will just spawn another goroutine to handle any incoming
requests, oblivious to the danger. In these situations, it can be useful to
implement some custom request throttling. Here I'll show an easy way to accomplish
this with the use of a Go channel.

## The Semaphore
I'm not going to introduce semaphores here, just show you how to implement one in Go
and what they can be used for. Firstly, the implementation:

```
type Semaphore chan struct{}

func (s Semaphore) ReleaseSlot() {
	// Read to release a slot
	<-s
}

func (s Semaphore) WaitForSlotAvailable(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	// Blocks while channel is full
	case s <- struct{}{}:
	}

	return nil
}
```

This makes quite elegant use of the blocking nature of Go channels. I particularly
like how this is also `context` aware, making it suitable for gRPC purposes.

Now lets say we have hungry method that we want to ensure doesn't run too often
in parallel. Here's how we'd do that:

```go
type MySrv struct {
    sem Semaphore
}

// NewSrv creates a server with slots being the maximum
// number of allowed parallel instances of HungryRPCMethod.
func NewSrv(slots int) &MySrv {
    return &MySrv{
        sem: make(Semaphore, slots)
    }
}

func (m *MySrv) HungrygRPCMethod(ctx context.Context, in *myproto.Request) (*myproto.Reply, error) {
    if err := m.sem.WaitForSlotAvailable(ctx); err != nil {
        return nil, err
    }
    defer m.sem.ReleaseSlot()

    ... // Go and do resource intensive things
}
```

That's it! The semaphore will ensure no more than `slots` number of instance of `HungryRPCMethod`
are running at any one time.

If you enjoyed this blog post, have any questions or input,
don't hesitate to contact me on
[@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear
your thoughts!

