"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { answerQuestion, businessDate, latestOrders } = require("./server");

const rates = { USD: 1, EUR: 1.11, INR: 0.01168 };
const rows = [
  { id: "A", customer: "C1001", region: "North", product: "Blender", qty: 2, amount: 100, currency: "USD", status: "paid", created_at: "2026-03-01T20:00:00Z", updated_at: "2026-03-02T00:00:00Z" },
  { id: "B", customer: "C1002", region: "North", product: "Toaster", qty: 3, amount: 100, currency: "EUR", status: "paid", created_at: "2026-03-05T10:00:00+05:30", updated_at: "2026-03-05T11:00:00+05:30" },
  { id: "C", customer: "C1001", region: "South", product: "Blender", qty: 1, amount: 20, currency: "USD", status: "refunded", created_at: "2026-03-10T10:00:00+05:30", updated_at: "2026-03-10T11:00:00+05:30" },
  { id: "D", customer: "C1003", region: "North", product: "Toaster", qty: 1, amount: 500, currency: "USD", status: "void", created_at: "2026-03-12T10:00:00+05:30", updated_at: "2026-03-12T11:00:00+05:30" },
];

test("uses Asia/Kolkata business dates for UTC timestamps", () => {
  assert.equal(businessDate("2026-02-28T20:00:00Z"), "2026-03-01");
});

test("keeps only the latest version of each order", () => {
  const current = latestOrders([
    { id: "A", amount: 12, updated_at: "2026-01-01T00:00:00Z" },
    { id: "A", amount: 15, updated_at: "2026-01-02T00:00:00Z" },
  ]);
  assert.equal(current.length, 1);
  assert.equal(current[0].amount, 15);
});

test("sums paid revenue in the requested currency and filters by region/date", () => {
  assert.equal(answerQuestion("What was total revenue in USD from the North region in March 2026?", rows, rates), 211);
});

test("counts refunded orders and aggregates refunded amount", () => {
  assert.equal(answerQuestion("How many refunds were there in March 2026?", rows, rates), 1);
  assert.equal(answerQuestion("What was the total refund amount in March 2026?", rows, rates), 20);
});

test("ranks products by units sold using paid orders", () => {
  assert.equal(answerQuestion("Which product sold the most units in March 2026?", rows, rates), "Toaster");
});

test("counts distinct customers in a filtered set", () => {
  assert.equal(answerQuestion("How many customers ordered from the North region in March 2026?", rows, rates), 3);
});

test("counts distinct customers instead of orders when orders is a status qualifier", () => {
  const kettleOrders = [
    { id: "K1", customer: "C1001", region: "North", product: "Kettle", qty: 1, amount: 50, currency: "USD", status: "paid", created_at: "2026-03-13T10:00:00+05:30", updated_at: "2026-03-13T11:00:00+05:30" },
    { id: "K2", customer: "C1001", region: "North", product: "Kettle", qty: 1, amount: 50, currency: "USD", status: "paid", created_at: "2026-03-14T10:00:00+05:30", updated_at: "2026-03-14T11:00:00+05:30" },
    { id: "K3", customer: "C1002", region: "North", product: "Kettle", qty: 1, amount: 50, currency: "USD", status: "refunded", created_at: "2026-03-15T10:00:00+05:30", updated_at: "2026-03-15T11:00:00+05:30" },
    { id: "K4", customer: "C1003", region: "North", product: "Kettle", qty: 1, amount: 50, currency: "USD", status: "void", created_at: "2026-03-16T10:00:00+05:30", updated_at: "2026-03-16T11:00:00+05:30" },
  ];
  assert.equal(answerQuestion("How many distinct customers have bought a Kettle (paid orders only)?", kettleOrders, rates), 1);
});
