import type { BudgetBand, CAProfile, CAMatch, Deadline, ObligationGroup, Profile } from './types'

const GROUP_STATE: Record<string, string> = {
  Telangana: 'Hyderabad',
  Karnataka: 'Bengaluru',
  Maharashtra: 'Pune',
  'Tamil Nadu': 'Chennai',
  Kerala: 'Kochi',
  Delhi: 'Delhi',
}

const BUDGET_ORDER: BudgetBand[] = ['under_10k', '10k_30k', '30k_60k', 'above_60k']

const BUDGET_LABEL: Record<BudgetBand, string> = {
  under_10k: 'under ₹10,000',
  '10k_30k': '₹10,000–30,000',
  '30k_60k': '₹30,000–60,000',
  above_60k: 'above ₹60,000',
}

function distance(a: BudgetBand, b: BudgetBand) {
  return Math.abs(BUDGET_ORDER.indexOf(a) - BUDGET_ORDER.indexOf(b))
}

/**
 * Transparent scoring, not a black box: 40% specialty fit, 20% location and
 * language, 15% budget, 15% rating, 10% availability. Payment never enters it.
 */
export function matchCAs(profile: Profile, deadlines: Deadline[], cas: CAProfile[], budget?: BudgetBand): CAMatch[] {
  const groups = new Map<ObligationGroup, number>()
  for (const d of deadlines) groups.set(d.group, (groups.get(d.group) ?? 0) + 1)
  const totalWeight = [...groups.values()].reduce((a, b) => a + b, 0) || 1

  return cas
    .map((ca) => {
      const covered = [...groups.entries()].filter(([g]) => ca.specialties.includes(g)).reduce((n, [, count]) => n + count, 0)
      const specialty = covered / totalWeight

      const sameState = profile.state ? GROUP_STATE[profile.state] === ca.city : false
      const languageHit = ca.languages.some((l) => l === 'English' || l === 'Telugu' || l === 'Hindi')
      const location = (sameState ? 0.7 : 0.15) + (languageHit ? 0.3 : 0)

      const budgetScore = budget ? Math.max(0, 1 - distance(budget, ca.fee_band) * 0.45) : 0.6
      const rating = (ca.rating / 5) * 0.8 + Math.min(1, ca.reviews / 50) * 0.2
      const availability = ca.accepting ? 1 : 0

      const score = Math.round((specialty * 0.4 + location * 0.2 + budgetScore * 0.15 + rating * 0.15 + availability * 0.1) * 100)

      const reasons: string[] = []
      const hits = ca.specialties.filter((g) => groups.has(g))
      if (hits.length) {
        const labels: Record<ObligationGroup, string> = {
          gst: 'GST',
          company_law: 'company law',
          income_tax: 'income tax and TDS',
          payroll: 'payroll',
          fema: 'FEMA and foreign investment',
          labour: 'state labour registrations',
        }
        reasons.push(`Handles ${hits.map((h) => labels[h]).join(', ')} — the work you actually have`)
      }
      if (sameState) reasons.push(`Based in ${ca.city}, in ${profile.state}`)
      else reasons.push(`Works remotely from ${ca.city}`)
      reasons.push(`Speaks ${ca.languages.slice(0, 2).join(' and ')}`)
      if (budget) reasons.push(`Fee band ${BUDGET_LABEL[ca.fee_band]} against your ${BUDGET_LABEL[budget]} budget`)
      if (!ca.accepting) reasons.push('Not accepting new clients right now')

      return {
        ca,
        score,
        reasons,
        breakdown: [
          { factor: 'Specialty fit', weight: 40, score: Math.round(specialty * 100) },
          { factor: 'Location and language', weight: 20, score: Math.round(Math.min(1, location) * 100) },
          { factor: 'Budget fit', weight: 15, score: Math.round(budgetScore * 100) },
          { factor: 'Rating and track record', weight: 15, score: Math.round(rating * 100) },
          { factor: 'Availability', weight: 10, score: availability * 100 },
        ],
      }
    })
    .sort((a, b) => b.score - a.score)
}
