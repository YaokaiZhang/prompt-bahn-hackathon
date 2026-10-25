import assert from "node:assert/strict"
import { test } from "node:test"
import { gate, homeFor, landingFor, parsePersona } from "./persona"

test("only the three personas are accepted; customer is not a persona", () => {
  assert.equal(parsePersona("operator"), "operator")
  assert.equal(parsePersona("site"), "site")
  assert.equal(parsePersona("driver"), "driver")
  assert.equal(parsePersona("customer"), null)
  assert.equal(parsePersona(""), null)
  assert.equal(parsePersona(undefined), null)
})

test("operator lands on the queue; site and driver land on the phone page", () => {
  assert.equal(homeFor("operator"), "/")
  assert.equal(homeFor("site"), "/phone")
  assert.equal(homeFor("driver"), "/phone")
})

test("with no persona, every page sends the person to the picker and keeps where they were going", () => {
  assert.deepEqual(gate(null, "/"), { kind: "redirect", to: "/login" })
  assert.deepEqual(gate(null, "/orders/ord-00001"), { kind: "redirect", to: "/login?next=%2Forders%2Ford-00001" })
  assert.deepEqual(gate(null, "/phone"), { kind: "redirect", to: "/login?next=%2Fphone" })
  assert.deepEqual(gate(null, "/login"), { kind: "allow" })
})

test("with no persona, the API answers 401 instead of redirecting", () => {
  assert.deepEqual(gate(null, "/api/overview"), { kind: "deny", status: 401 })
})

test("site and driver cannot reach the operator's pages or API", () => {
  for (const persona of ["site", "driver"] as const) {
    assert.deepEqual(gate(persona, "/"), { kind: "redirect", to: "/phone" })
    assert.deepEqual(gate(persona, "/orders/ord-00001"), { kind: "redirect", to: "/phone" })
    assert.deepEqual(gate(persona, "/inbox"), { kind: "redirect", to: "/phone" })
    assert.deepEqual(gate(persona, "/board"), { kind: "redirect", to: "/phone" })
    assert.deepEqual(gate(persona, "/api/overview"), { kind: "deny", status: 403 })
    assert.deepEqual(gate(persona, "/phone"), { kind: "allow" })
    assert.deepEqual(gate(persona, "/api/phone/events"), { kind: "allow" })
    assert.deepEqual(gate(persona, "/login"), { kind: "allow" })
  }
})

test("the operator reaches everything, including the phone page for rehearsal", () => {
  for (const path of ["/", "/board", "/orders/ord-00001", "/inbox", "/api/overview", "/phone", "/login"]) {
    assert.deepEqual(gate("operator", path), { kind: "allow" })
  }
})

test("after choosing, the picker returns to the page asked for only when the persona may open it; else the operator gets the start page", () => {
  assert.equal(landingFor("operator", "/orders/ord-00001"), "/orders/ord-00001")
  assert.equal(landingFor("operator", null), "/start")
  assert.equal(landingFor("site", "/orders/ord-00001"), "/phone")
  assert.equal(landingFor("driver", "/phone"), "/phone")
  assert.equal(landingFor("operator", "//evil.example"), "/start")
  assert.equal(landingFor("operator", "https://evil.example"), "/start")
  assert.equal(landingFor("operator", "/login"), "/start")
  assert.equal(landingFor("operator", "/start"), "/start")
  assert.deepEqual(gate("site", "/start"), { kind: "redirect", to: "/phone" })
})

test("a lookalike path is not mistaken for the phone page", () => {
  assert.deepEqual(gate("site", "/phonebook"), { kind: "redirect", to: "/phone" })
})
