+++
date = "2017-04-13"
title = "GopherJS Client and gRPC Server - Part 3"
subtitle ="A guide to implementing a GopherJS frontend to a gRPC backend exposed over HTTP via the gRPC-gateway"
tags = [ "golang", "protobuf", "grpc", "grpc-gateway", "gopherjs" ]
+++
## Implement the client
GopherJS can be used in a couple of different ways, and there's a couple of different
bindings to many popular JavaScript frameworks.
The [GopherJS wiki](https://github.com/gopherjs/gopherjs/wiki/bindings)
has some great resources.

I tried a couple of different ones and ended up using the
[VueJS bindings](https://github.com/oskca/gopherjs-vue) because it made it easy to
prototype things quickly. I hear [VueJS](https://vuejs.org/) works well for many JS
evangelisers out there, but I've only used it with small projects. It'll do for this
blog post, but in the future I want to try working with
[myitcv's React bindings](https://github.com/myitcv/react) and the
[Vecty toolkit](https://github.com/gopherjs/vecty).

One of the biggest problems with GopherJS at the moment is it
[does not have deadcode elimination](https://github.com/gopherjs/gopherjs/issues/136).
This can be remedied by avoiding many standard library packages. Throughout this I've kept
minimizing generated file size a priority, to show that it's possible to implement
fully featured frontend apps with GopherJS without compromising on file size.

To make things a little saner we'll create a couple of folders again.
Lets add `compiled` and `html` to the `client` folder:

```bash
$ cd client && tree -L 1 -d
.
|-- compiled
|-- html
`-- protos
```

Next we'll define the `HTML` of our page. Create `index.html` in the `html` folder.
It's not supposed to be anything fancy, we just want a skeleton for our GopherJS code.
The full HTML can be found on
[my github](https://github.com/johanbrandhorst/gopherjs-grpc-websocket/blob/4f15a95d84ed6e60ce70359204ce2a64c3021776/client/html/index.html),
but it won't make sense without looking at the GopherJS code!

Skipping out on some boilerplate, we'll start with the Simple button:
```html
<div id="app" v-cloak>
	<h1>gRPC through gopherjs!</h1>
	<p>
		<h2>Simple</h2>
		<button v-if="!simple_message" @click="Simple()">Send GET</button>
		<div v-if="simple_message">
			Message: {{ simple_message.msg }}, Num: {{ simple_message.num }}
		</div>
	</p>
</div>
<script src="index.js"></script>
```
This creates a button with the label `Send GET`, that will, when clicked, call the
function `Simple`. There's also all kinds of references to things we haven't seen yet
so lets move on to the GopherJS code. Again, you can skip ahead and see the full code
on [my github](https://github.com/johanbrandhorst/gopherjs-grpc-websocket/blob/4f15a95d84ed6e60ce70359204ce2a64c3021776/client/client.go). Create `client.go` in the `client` folder.

```go
package main

//go:generate gopherjs build -m client.go -o html/index.js
//go:generate go-bindata -pkg compiled -nometadata -o compiled/client.go -prefix html ./html
//go:generate bash -c "rm html/*.js*"

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/johanbrandhorst/gopherjs-json"
	"github.com/oskca/gopherjs-vue"
	"honnef.co/go/js/xhr"

	"github.com/johanbrandhorst/gopherjs-grpc-websocket/client/helpers"
	"github.com/johanbrandhorst/gopherjs-grpc-websocket/client/protos/server"
)

type MyMessage struct {
	*js.Object
	Msg string `js:"msg"`
	Num uint32 `js:"num"`
}

// Model is the state keeper of the app.
type Model struct {
	*js.Object
	SimpleMessage *MyMessage   `js:"simple_message"`
}

func (m *Model) Simple() {
	req := xhr.NewRequest("GET", "/api/v1/simple")
	req.SetRequestHeader("Content-Type", "application/json")

	// Wrap call in goroutine to use blocking code
	go func() {
		// Blocks until reply received
		err := req.Send(nil)
		if err != nil {
			panic(err)
		}

		if req.Status != 200 {
			panic(req.ResponseText)
		}

		rObj, err := json.Unmarshal(req.ResponseText)
		if err != nil {
			panic(err)
		}

		msg := &MyMessage{
			Object: rObj,
		}

		m.SimpleMessage = msg
	}()
}

func main() {
	m := &Model{
		Object: js.Global.Get("Object").New(),
	}

	// These must be set after the struct has been initialised
	// so that the values can be mirrored into the internal JS Object.
	m.SimpleMessage = nil

	// Create the VueJS viewModel using a struct pointer
	vue.New("#app", m)
}
```
There's quite a bit to break down here, so we'll start from the top.

GopherJS requires packages to pretend that they're binaries,
so we must use `package main` at the top.

Then we've got a couple of `go generate` directives that will create and pack
the JS file so that we can easily serve it from the server later on.

```go
//go:generate gopherjs build -m client.go -o html/index.js
//go:generate go-bindata -pkg compiled -nometadata -o compiled/client.go -prefix html ./html
//go:generate bash -c "rm html/*.js*"
```

The first one will compile `client.go` file into `html/index.js`. The `-m`
flag creates a minified JS output file.

The second one uses the excellent [go-bindata](https://github.com/jteeuwen/go-bindata)
to generate a convenience package for serving static content from a
Go webserver. It means we can distribute
a single binary which contains both the webserver logic and the static content.
The `-pkg` flag is the name of the package that is generated, the `-prefix` flag
removes the specified path from the path in the package. We'll see later how to use it.

The last one just removes the generated JS file. We do this because all the
data is already in the package we generated in step two and the generated JS
is just a huge unmanageable text file. Who likes looking at JS anyway ;)?

Then we've got the `MyMessage` struct. It's manually crafted to correspond
to the one defined in the protofile.

```go
type MyMessage struct {
	*js.Object
	Msg string `js:"msg"`
	Num uint32 `js:"num"`
}
```

The `js` struct tag tells GopherJS what the variable should be called in the JS world,
and by extension, in the `HTML`. So when we look back at the `HTML` we
defined it should now be clearer how things work.

Next up we've got the `Model`.

```go
// Model is the state keeper of the app.
type Model struct {
	*js.Object
	SimpleMessage *MyMessage   `js:"simple_message"`
}
```

Any Go structs that we want to use with JS need to embed the GopherJS `*js.Object` type.
[This is a quirk of GopherJS](https://github.com/gopherjs/gopherjs/wiki/JavaScript-Tips-and-Gotchas),
we'll see more later about what it means.

The `Model` is required by the `VueJS` bindings, and is how we communicate between the Go
world and the `HTML`. Anything we assign to properties on the `Model` will be reflected
in the `HTML` and all methods defined on the `Model` are accessible from the `HTML`.


```html
<p>
	<h2>Simple</h2>
	<button v-if="!simple_message" @click="Simple()">Send GET</button>
	<div v-if="simple_message">
		Message: {{ simple_message.msg }}, Num: {{ simple_message.num }}
	</div>
</p>
```

I'm a little unhappy about keeping logic in the markup, especially when it means using
JS logic, but it'll do for this short introduction. So we show the button if `simple_message`
is unpopulated, otherwise we display the contents of the `simple_message`.

Next up we've got the definition of the `Simple` function.
```go
func (m *Model) Simple() {
	req := xhr.NewRequest("GET", "/api/v1/simple")
	req.SetRequestHeader("Content-Type", "application/json")

	// Wrap call in goroutine to use blocking code
	go func() {
		// Blocks until reply received
		err := req.Send(nil)
		if err != nil {
			panic(err)
		}

		if req.Status != 200 {
			panic(req.ResponseText)
		}

		rObj, err := json.Unmarshal(req.ResponseText)
		if err != nil {
			panic(err)
		}

		msg := &MyMessage{
			Object: rObj,
		}

		m.SimpleMessage = msg
	}()
}
```
We'll use the excellent [xhr](https://godoc.org/honnef.co/go/js/xhr) package for
interacting with the API the server exposes. Using the `xhr` library means we can
avoid importing `net/http` which adds 3MB to the generated JS file size.

Another quirk of GopherJS is that blocking code must be wrapped in a goroutine,
this is apparently because JS cannot contain blocking code.
You can find more information about this quirk in the
[GopherJS README](https://github.com/gopherjs/gopherjs#goroutines).

As you can probably see, we're using `panic` quite liberally in this code,
compared to how it would be used in real Go code. A `panic` in GopherJS
will dump the stack to the browser console, which is fine for
something simple like this, but in a real app you might want to capture the
error produced and assign it to something in the `Model` to make it visible
to the user.

Next we use [a simple json helper library](https://github.com/johanbrandhorst/gopherjs-json)
to create a GopherJS `*js.Object` from the `JSON` string the server responds with. Because
we know the `JSON` is of the type `MyMessage`, we can use the `*js.Object`
returned to intialise a new `MyMessage` from the object,
and use that to update the `Model`. Simple!

Lastly we've got the `main` boilerplate:

```go
func main() {
	m := &Model{
		Object: js.Global.Get("Object").New(),
	}

	// These must be set after the struct has been initialised
	// so that the values can be mirrored into the internal JS Object.
	m.SimpleMessage = nil

	// Create the VueJS viewModel using a struct pointer
	vue.New("#app", m)
}
```

Whenever we create a GopherJS struct, a new `*js.Object` needs to be assigned to it.
Any properties on the GopherJS structs need to be initialized after the object
has been assigned to it. Note that we must _explicitly_ initialize properties on
the `Model`, in order for the value to be reflected in the underlying
`*js.Object`. This is just another quirk of GopherJS.

We use the `VueJS bindings` to create the app. The first parameter is the identifier
of the element in the `HTML` which we want to populate the app with.

We've got just enough here for a minimal GopherJS frontend to a grpc-gateway proxied
Go gRPC server. But we're still missing the really interesting stuff! Lets implement the
unary streaming function as well:

```html
<p>
    <h2>Unary</h2>
    <button v-if="unary_messages.length == 0" @click="Unary()">Send GET</button>
    <div v-if="unary_messages">
        <div v-for="msg in unary_messages">
            Message: {{ msg.msg }}, Num: {{ msg.num }}
        </div>
    </div>
</p>
```

This is very similar to the simple one, but we iterate over the messages as they come in.
Next we need to add something to the model, to display the unary messages.

```go
type Model struct {
	...
	UnaryMessages []*MyMessage `js:"unary_messages"`
}
```

We'll need to initialize the new struct member in the `main` function as well.

```go
func main() {
	...
	m.UnaryMessages = []*MyMessage{}
	...
}
```

Now we can implement the `Unary` streaming function.

```go
func getStreamMessage(msg string) *MyMessage {
	rObj, err := json.Unmarshal(msg)
	if err != nil {
		panic(err)
	}

	// The actual message is wrapped in a "result" key,
	// and there might be an error returned as well.
	// See https://github.com/grpc-ecosystem/grpc-gateway/blob/b75dbe36289963caa453a924bd92ddf68c3f2a62/runtime/handler.go#L163
	aux := &struct {
		*js.Object
		msg *MyMessage `js:"result"`
	}{
		Object: rObj,
	}

	// The most reliable way I've found to check whether
	// an error was returned.
	if rObj.Get("error").Bool() {
		panic(msg)
	}

	return aux.msg
}

func (m *Model) Unary() {
	req := xhr.NewRequest("GET", "/api/v1/unary")
	req.SetRequestHeader("cache-control", "no-cache")
	req.SetRequestHeader("Content-Type", "application/json")

	bytesRead := 0
	req.AddEventListener("readystatechange", false, func(_ *js.Object) {
		switch req.ReadyState {
		case xhr.Loading:
			// This whole dance is because the XHR ResponseText
			// will contain all the messages, and we just want to read
			// anything we havent already read
			resp := req.ResponseText[bytesRead:]
			bytesRead += len(resp)

			m.UnaryMessages = append(m.UnaryMessages, getStreamMessage(resp))
		}
	})

	// Wrap call in goroutine to use blocking code
	go func() {
		// Blocks until reply received
		err := req.Send(nil)
		if err != nil {
			panic(err)
		}

		if req.Status != 200 {
			panic(req.ResponseText)
		}
	}()
}
```

While I'm quite happy with the overall simplicity of this, unfortunately it's
very much JS in Go clothing. I haven't found a better way to handle periodically
updating requests. Again, the `xhr` library makes this much nicer. Unfortunately
the grotesque error check inside the handler is, as far as I can tell, unavoidable.
Hopefully most of the other stuff should be fairly self-explanatory with the comments.

That leaves us with the bidi-websocket streaming functions left to implement. I wanted
this to show off the capabilities of the websocket protocol, so it's a little more elaborate
than it probably needed to be. This'll be a bit of a code dump but I think most of this
should be reasonable easy to understand, given what we've talked about so far.

```html
<p>
	<h2>Bidi</h2>
	<div v-if="!ws_conn">
		<button @click="Connect()">Connect to Websocket</button>
	</div>
	<form v-if="ws_conn" v-on:submit.prevent>
		<input type="text" v-model="input_message"></input>
		<button @click="Send()">Send Websocket message</button>
		<button @click="Close()">Close Websocket</button>
	</form>
	<div v-if="bidi_messages">
		<div v-for="msg in bidi_messages">
			Message: {{ msg.msg }}, Num: {{ msg.num }}
		</div>
	</div>
</p>
```

```go
type Model struct {
	...
	InputMessage  string              `js:"input_message"`
	BidiMessages  []*MyMessage `js:"bidi_messages"`
	ConnOpen      bool                `js:"ws_conn"`
}

func main() {
	...
	m.BidiMessages = []*MyMessage{}
	m.InputMessage = ""
	m.ConnOpen = false
	...
}

// GetWSBaseURL constructs the base URL for WebSocket calls
// Copied from
// https://github.com/gopherjs/websocket/blob/edfe1438a4184bea0b3f9e35fd77969061676d9c/test/test/index.go
func GetWSBaseURL() string {
	document := js.Global.Get("window").Get("document")
	location := document.Get("location")

	wsProtocol := "ws"
	if location.Get("protocol").String() == "https:" {
		wsProtocol = "wss"
	}

	return wsProtocol + "://" + location.Get("hostname").String() + ":" + location.Get("port").String()
}

func (m *Model) Connect() {
	// Wrap call in goroutine to use blocking code
	go func() {
		// Blocks until connection is established
		var err error
		WSConn, err = websocket.Dial(GetWSBaseURL() + "/api/v1/bidi")
		if err != nil {
			panic(err)
		}

		m.ConnOpen = true
	}()
}

func (m *Model) Close() {
	err := WSConn.Close()
	if err != nil {
		panic(err)
	}

	m.ConnOpen = false
	m.InputMessage = ""
	m.BidiMessages = []*MyMessage{}
}

func (m *Model) Send() {
	msg := &MyMessage{
		Object: js.Global.Get("Object").New(),
	}
	msg.Msg = m.InputMessage
	s, err := json.Marshal(msg.Object)
	if err != nil {
		panic(err)
	}

	_, err = WSConn.Write([]byte(s))
	if err != nil {
		panic(err)
	}

	buf := make([]byte, 1024)
	// Wrap call in goroutine to use blocking code
	go func() {
		// Blocks until a WebSocket frame is received
		n, err := WSConn.Read(buf)
		if err != nil {
			panic(err)
		}

		m.BidiMessages = append(m.BidiMessages, getStreamMessage(string(buf[:n])))
	}()
}
```

In this, we have separate functions for connecting to the WebSocket,
sending and reading a message, and closing the WebSocket. We use another
excellent GopherJS package, the [websocket](https://github.com/gopherjs/websocket)
wrapper for working with the browsers native websockets. The `Send` function
takes the text from the form input, marshals it to JSON and sends it on the websocket.
It then reads until it gets a reply. Obviously this can be designed differently
if we need different behaviour.

Now that we've finished the client, we need to put everything together.
