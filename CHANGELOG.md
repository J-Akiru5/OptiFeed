# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## --- KARL'S PROGRESS (Branch) ---

## [1.5.0] - 2026-07-08

### Added
- Implemented global Realtime Notifications via Supabase WebSocket subscriptions
- Added sticky banners for `CRITICAL` alerts and toast notifications for `WARNING`/`SUCCESS` alerts
- Wired up the navigation bell to instantly reflect live unread counts


## [1.4.0] - 2026-07-08

### Added
- Implemented Schedule screen with Server Actions for pause/resume and manual override (Feed Now)
- Added `isPaused` field to `Device` model in Prisma schema

## [1.3.0] - 2026-07-08

### Added
- Implemented Feeding History screen with recent activity stats and events log
- Implemented Growth & FCR screen with custom SVG/CSS charts and biomass history table

## [1.2.0] - 2026-07-07

### Added
- Created Biomass Log Sample form with live volume calculation preview
- Added `saveBiomassLog` Server Action and `calculateNextFeeding` math utility

## --- MAIN PROGRESS (origin/main) ---

## [1.1.0] - 2026-07-07

### Added
- Wired Dashboard Home (Hero, FCR sparkline, and secondary metrics cards) to live Prisma data

## [1.0.1] - 2026-07-07

### Added
- Added Prisma seed data for local development

## [0.1.0] - 2026-07-05

### Added
- Initial project scaffold: Next.js App Router, Supabase, Prisma schema + migration, next-intl (en/hil), Tailwind design tokens, Husky + Biome, GitHub Actions CI/CD, base docs.
