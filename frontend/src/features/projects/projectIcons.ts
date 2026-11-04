/**
 * Purpose: Emoji lookups for project kind / status, shared by the list card
 *   and the project focus screen.
 * Version: v1 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Constants only, no logic. Imported by ProjectCard.tsx and
 *   ProjectScreen.tsx so the two views can't drift apart.
 */
import type { ProjectKind, ProjectStatus } from '../../api/types'

export const KIND_ICON: Record<ProjectKind, string> = {
  haul_out: '🛠️', refit: '🏗️', campaign: '⛵', service_period: '📤', other: '🗂️',
}
export const STATUS_ICON: Record<ProjectStatus, string> = {
  planned: '🅿️', active: '🟢', done: '✅', cancelled: '⚪',
}
