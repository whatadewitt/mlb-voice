#!/usr/bin/env node
// Offline batch script generator for the AdLibrary.
// Reads data/ad_products.json + data/ad_templates.json, fans out the
// product × template cross-product against the configured LLM, and writes
// one .txt per pair into data/ad_scripts/.
//
// Usage:
//   node scripts/genAds.js
//   SCRIPT_MODEL=gpt-4o node scripts/genAds.js
import "dotenv/config";
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// gpt-5 family and o-series reasoning models reject non-default temperature.
function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

const products = JSON.parse(readFileSync("data/ad_products.json", "utf8")).products;
const templates = JSON.parse(readFileSync("data/ad_templates.json", "utf8")).templates;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.SCRIPT_MODEL || "gpt-5";
mkdirSync("data/ad_scripts", { recursive: true });

for (const p of products) {
  for (const t of templates) {
    const id = `${p.id}__${t.id}`;
    const request = {
      model,
      messages: [
        { role: "system", content: t.system },
        { role: "user", content: `Product: ${p.name}\nPitch: ${p.pitch}\nWrite the ad now.` },
      ],
    };
    if (modelAcceptsTemperature(model)) request.temperature = 0.95;
    try {
      const out = await openai.chat.completions.create(request);
      const script = (out.choices[0]?.message?.content ?? "").trim();
      if (!script) {
        console.error("✗", id, "empty completion");
        continue;
      }
      writeFileSync(join("data/ad_scripts", `${id}.txt`), script + "\n");
      console.log("✓", id);
    } catch (e) {
      console.error("✗", id, String(e.message ?? e));
    }
  }
}
