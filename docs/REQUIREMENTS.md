# Initial Requirements

Captured from the original project brief (2026-06-12). These are the goals the
first version was built against; deviations are noted in
[ARCHITECTURE.md](ARCHITECTURE.md) with reasoning.

## Vision

A game like **OpenTTD** (transport routes, industry chains, economy) but with
**modern graphics in the spirit of Cities: Skylines 2**, whose special twist is
**energy management**: the player runs a 100% electric, 100% renewable region.

> The aspect of teaching how that works in a very easy and playable fun way is
> the main goal of the game.

## Functional requirements

1. **Transport tycoon core**
   - Cities and industries connected by player-built infrastructure
   - Vehicles run routes and earn money for deliveries
   - All vehicles are **electric** (their charging is real grid load)

2. **Energy management (the twist)**
   - Renewable sources: **solar**, **wind**, **water** (hydro)
   - **Battery storage** as the daily workhorse
   - **Hydrogen**: electrolyzers convert midday solar surplus to H₂, stored and
     reconverted at night or on later days
   - Realistic behavior researched from real-world data (capacity factors,
     efficiencies, weather dependence)

3. **Electrified industry**
   - Production sites are electric consumers (explicit example: **green steel**)
   - Industry output depends on the grid being served

4. **Player-built generation**
   - The user must manage and build renewable sources to match demand

5. **Research**
   - Improve generation over time (more power per asset)
   - Improve the consumer side (efficiency)

6. **Teaching (primary goal)**
   - Convey how modern renewable approaches work in complex, energy-hungry
     environments — easy, playable, fun

7. **Insights**
   - Good visibility into economy and energy consumption/production so the
     player can adapt and always knows what is going on

8. **Living world**
   - Noticeable population: cars driving around, people walking the streets,
     going to bus stations — the world should feel alive

## Non-functional requirements (derived)

- Runs locally with minimal setup (chosen: browser + static file server)
- "Really great up to date graphics" within the constraints of a from-scratch
  browser game: real-time shadows, PBR-ish materials, day/night cycle, fog,
  tonemapping (a stylized low-poly look — an honest interpretation, not a
  AAA engine clone)
- Realism anchored to real-world magnitudes wherever the energy model is
  concerned (see [ENERGY-MODEL.md](ENERGY-MODEL.md))
