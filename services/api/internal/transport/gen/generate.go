// Package gen is the server interface and types generated from
// api/openapi.yaml, the contract (burgstaller-platform
// standards/api/contract.md).
package gen

//go:generate go tool oapi-codegen -generate types,chi-server,spec -package gen -o api.gen.go ../../../../../api/openapi.yaml
