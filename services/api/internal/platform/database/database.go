// Package database opens the app's database on the platform's shared
// Postgres and brings its schema up to date. Infrastructure only.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/migrations"
)

// MaxConns is this service's share of the shared instance (db-f1-micro,
// about 25 connections for every app together). It runs one instance and
// does little, so 3 is plenty.
const MaxConns = 3

// Open returns a pool against url, once the schema is up to date. A failed
// migration returns an error, so the revision never serves and Cloud Run
// keeps the one before it (standards/data/migrations.md).
func Open(ctx context.Context, url string, log func(string, ...any)) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse the database URL: %w", err)
	}
	pc.MaxConns = MaxConns
	pc.MinConns = 0
	pc.MaxConnIdleTime = 2 * time.Minute
	pc.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("open the pool: %w", err)
	}
	if err := migrate(ctx, pool, log); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// migrate runs the migrations on one connection of the pool: Apply holds an
// advisory lock for the whole run, which a pool could hand from one
// backend to another.
func migrate(ctx context.Context, pool *pgxpool.Pool, log func(string, ...any)) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Release()
	if err := migrations.Apply(ctx, conn.Conn(), log); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
