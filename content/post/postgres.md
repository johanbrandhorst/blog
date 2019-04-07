---
title: "How I use Postgres with Go"
subtitle: "The libraries I love to use with Postgres"
date: 2019-04-07
tags: ["go", "postgres", "docker"]
---

Most developers will have to interact with SQL at some point in their career,
and often nowadays that means working with [Postgres](http://postgresql.org/).
I've been using Postgres with Go for a few years now and have found a couple
of libraries that work really well together to make the Go Postgres experience
productive, safe and _fun_.

TL:DR; I have created an example repo that puts all of the below into practice:
[github.com/johanbrandhorst/grpc-postgres](https://github.com/johanbrandhorst/grpc-postgres).

The libraries cover four separate parts and integrate very well together.
First up, lets look at the database driver I use:

## Database driver

My Postgres database driver of choice is
[github.com/jackc/pgx](https://github.com/jackc/pgx). I often recommend `pgx`
over [github.com/lib/pq](https://github.com/lib/pq), having used both in various
projects over the years. `pq` is often the first driver recommended, and it is
certainly competent and performant, but it has nothing on the rich type
support in [`pgx/pgtype`](https://godoc.org/github.com/jackc/pgx/pgtype), and
the direct database interface implemented in `pgx` comes in handy when you need
that extra boost of performance in your application. I prefer to use `pgx` via
the `stdlib` interface most of the time to make the code more familiar with
other Go database code, since performance is not always the most important part.

The [custom type handling](https://github.com/johanbrandhorst/grpc-postgres/blob/14c4878f4e5f38bf7b27cb0ac5c077fa563f8d12/users/types.go#L56)
in my example repo shows how to use the postgres types
`timestamptz` and `interval` from your Go application:

```go
func (tw *timeWrapper) Scan(in interface{}) error {
	var t pgtype.Timestamptz
	err := t.Scan(in)
	if err != nil {
		return err
	}

	tp, err := ptypes.TimestampProto(t.Time)
	if err != nil {
		return err
	}

	*tw = (timeWrapper)(*tp)
	return nil
}
```

Next, database setup and migrations:

## Setup and migrations

The library I use for setup and migrations is
[github.com/golang-migrate/migrate](https://github.com/golang-migrate/migrate).
It integrates directly with postgres via the
[PostgreSQL driver](https://github.com/golang-migrate/migrate/blob/master/database/postgres)
but supports
[many other databases](https://github.com/golang-migrate/migrate/#databases). I
use the Postgres driver together with the
[go-bindata source driver](https://github.com/golang-migrate/migrate/blob/master/source/go_bindata).
This allows me to embed the migrations into the binaries I build, ensuring the
database migrations are versioned in SCM together with the logic that is used to
interact with the database and also allows distribution of a single static
binary. I use `go generate` or a Makefile to ensure that it's easy to
generate the bindata file. I recommend using a CI script to ensure the file is
always up to date with the source files.

For a practical implementation of this, see
[the migration files](https://github.com/johanbrandhorst/grpc-postgres/tree/master/users/migrations)
and the
[schema setup code](https://github.com/johanbrandhorst/grpc-postgres/blob/14c4878f4e5f38bf7b27cb0ac5c077fa563f8d12/users/helpers.go#L18)
in my example repo:

```go
// version defines the current migration version. This ensures the app
// is always compatible with the version of the database.
const version = 1

func validateSchema(db *sql.DB) error {
	sourceInstance, err := bindata.WithInstance(bindata.Resource(migrations.AssetNames(), migrations.Asset))
	if err != nil {
		return err
	}
	targetInstance, err := postgres.WithInstance(db, new(postgres.Config))
	if err != nil {
		return err
	}
	m, err := migrate.NewWithInstance("go-bindata", sourceInstance, "postgres", targetInstance)
	if err != nil {
		return err
	}
	err = m.Migrate(version) // current version
	if err != nil && err != migrate.ErrNoChange {
		return err
	}
	return sourceInstance.Close()
}
```

Next up, the query builder:

## Query builder

I use [github.com/Masterminds/squirrel](https://github.com/Masterminds/squirrel)
for writing queries. Using
[fluent interfaces](https://en.wikipedia.org/wiki/Fluent_interface) in Go is
quite rare, and it rarely works well because of the limitations of Go's type
system. In the case of SQL query building though, I have found it to be an
excellent alternative to string interpolation so often seen elsewhere. It makes
it trivial to conditionally add `WHERE` clauses, etc. It doesn't try to do too
much either, simply aiming to allow anything in the SQL standard. Methods like
`.Suffix`, `.Prefix` and `squirrel.Expr` can be used to add arbitrary SQL where
required.

To use `squirrel` effectively with Postgres, I recommend creating a
`StatementBuilder` on startup, like the
[setup method](https://github.com/johanbrandhorst/grpc-postgres/blob/14c4878f4e5f38bf7b27cb0ac5c077fa563f8d12/users/users.go#L28)
in the example repo does:

```go
sb:     squirrel.StatementBuilder.PlaceholderFormat(squirrel.Dollar).RunWith(db),
```

This means you can run queries directly on `sb`, as we can see below.

The [`AddUser` method](https://github.com/johanbrandhorst/grpc-postgres/blob/14c4878f4e5f38bf7b27cb0ac5c077fa563f8d12/users/users.go#L56)
in the example repo shows a simple insert with `squirrel`. It explicitly maps
the value to the column name, and with a suffix statement we tell Postgres to
return the inserted row:

```go
func (d Directory) AddUser(ctx context.Context, req *pbUsers.AddUserRequest) (*pbUsers.User, error) {
	q := d.sb.Insert(
		"users",
	).SetMap(map[string]interface{}{
		"role": (roleWrapper)(req.GetRole()),
	}).Suffix(
		"RETURNING id, role, create_time",
	)

	return scanUser(q.QueryRowContext(ctx))
}
```

The
[`ListUsers` method](https://github.com/johanbrandhorst/grpc-postgres/blob/14c4878f4e5f38bf7b27cb0ac5c077fa563f8d12/users/users.go#L84)
shows the use of conditional `WHERE` clauses in our query:

```go
q := d.sb.Select(
    "id",
    "role",
    "create_time",
).From(
    "users",
).OrderBy(
    "create_time ASC",
)

if req.GetCreatedSince() != nil {
    q = q.Where(squirrel.Gt{
        "create_time": (*timeWrapper)(req.GetCreatedSince()),
    })
}

if req.GetOlderThan() != nil {
    q = q.Where(
        squirrel.Expr(
            "CURRENT_TIMESTAMP - create_time > $1", (*durationWrapper)(req.GetOlderThan()),
        ),
    )
}
```

`squirrel.Gt` is translated to `>` in the SQL, and it's trivial to see that it
applies to the `create_time` column. `squirrel.Expr` is here used to include
a raw SQL statement in our `WHERE` clause. We're using a custom type to allow us
to control the mapping to the Postgres Interval type used in the comparison.

A small comment on where the line between using `squirrel` and `migrate` is.
`squirrel` does not even try to let you write any `CREATE` or `DROP` statements
dynamically, which is where `migrate` comes in. Use `migrate` to create and
evolve your database schema, and use `squirrel` for inserts, queries, deletes
etc.

Next, the final piece of the puzzle: testing the database layer.

## Testing

I used to be a frequent user of
[github.com/DATA-DOG/go-sqlmock](https://github.com/DATA-DOG/go-sqlmock) to
test my database interactions. It made it possible to get 100% test coverage
and test all the error cases, but the problem is that you have to write both
the queries for interacting with the database and the code that is testing that
those queries are correct. This either means you write your queries twice, or
you copy paste your queries into your test. In either case, you gain no actual
confidence that your queries actually do what you want them to, or are even
valid SQL.

Therefore, I nowadays recommend the use of
[github.com/ory/dockertest](https://github.com/ory/dockertest) to spin up a
Postgres container and run your tests against it directly. This is now so fast
that these integration type tests can be run almost as quickly as normal unit
tests, but they provide you with 100% confidence that your queries are valid
SQL and extract the right data from the database. This has frankly
revolutionised database testing for me, to the point where I normally don't
bother writing unit tests for my database interactions because it would just be
testing rare error cases anyway. The only downside is that it can sometimes be
complicated to get this setup working in CI, but I've been able to solve it in
most cases, see [my previous posts](/post/circleci-docker-compose).

The example repo comes complete with some tests implemented with `dockertest`.
Most of the magic is in
[the database setup](https://github.com/johanbrandhorst/grpc-postgres/blob/2b12f7a2b44623efcbc627b896f242da0c7462d6/users/users_test.go#L29).

## Conclusion

I've covered `pgx`, `migrate`, `squirrel` and `dockertest`, four libraries that
together make working with Postgres from Go a real pleasure. I hope this brief
post can help you in your own interactions with Postgres from Go. With the
exception of `pgx`, most of the advice here applies to any relational database.

If you enjoyed this blog post, have any questions or input, don't hesitate to
contact me on [@johanbrandhorst](https://twitter.com/JohanBrandhorst) or
under `jbrandhorst` on the Gophers Slack. I'd love to hear your thoughts!
