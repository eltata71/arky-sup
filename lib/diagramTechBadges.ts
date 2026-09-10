/**
 * Canonical technology badges.
 *
 * Each entry matches a label / kind string (case-insensitive regex) and maps
 * to a brand-accurate chip (background + text colour + display label).  Kept
 * deliberately conservative: colours are taken from each vendor's public brand
 * guidelines.  Extend by appending to the bottom of the list — order matters
 * only for overlapping regex, in which case the most specific patterns should
 * come first.
 *
 * Consumed by `components/CustomNode.tsx` (ribbon/chip rendering) and prompts
 * that want to reference "recognised technologies" when evaluating quality.
 */

export interface TechBadge {
    readonly match: RegExp;
    readonly label: string;
    readonly bg: string;
    readonly text: string;
}

export const OFFICIAL_TECH_BADGES: readonly TechBadge[] = [
    // --- Cloud hyperscalers -------------------------------------------------
    { match: /\baws\b|amazon|\bses\b|\bsqs\b|\bsns\b|lambda|dynamodb|\brds\b|\bs3\b|eks|ecs|cloudfront/i, label: 'AWS', bg: '#FF9900', text: '#111827' },
    { match: /\bazure\b|entra|active\s+directory|cosmosdb|aks\b|app\s*service/i, label: 'Microsoft Azure', bg: '#0078D4', text: '#ffffff' },
    { match: /\bgcp\b|google\s*cloud|bigquery|pub\/sub|gke\b|firestore|cloud\s+run/i, label: 'Google Cloud', bg: '#4285F4', text: '#ffffff' },
    { match: /cloudflare|workers\s+kv/i, label: 'Cloudflare', bg: '#F38020', text: '#ffffff' },
    { match: /vercel/i, label: 'Vercel', bg: '#000000', text: '#ffffff' },
    { match: /netlify/i, label: 'Netlify', bg: '#00C7B7', text: '#0b0f13' },

    // --- Integration / iPaaS ----------------------------------------------
    { match: /mulesoft|anypoint/i, label: 'MuleSoft', bg: '#00A1DF', text: '#ffffff' },
    { match: /boomi/i, label: 'Boomi', bg: '#00B7C3', text: '#ffffff' },
    { match: /informatica/i, label: 'Informatica', bg: '#FF4F1A', text: '#ffffff' },

    // --- Enterprise vendors -------------------------------------------------
    { match: /oracle|\boci\b/i, label: 'Oracle', bg: '#C74634', text: '#ffffff' },
    { match: /\bsap\b|successfactors|s\/4hana/i, label: 'SAP', bg: '#0A6CFF', text: '#ffffff' },
    { match: /salesforce|service\s+cloud|sales\s+cloud|experience\s+cloud/i, label: 'Salesforce', bg: '#00A1E0', text: '#ffffff' },
    { match: /servicenow/i, label: 'ServiceNow', bg: '#62D84E', text: '#0b0f13' },
    { match: /workday/i, label: 'Workday', bg: '#F38B00', text: '#0b0f13' },
    { match: /hubspot/i, label: 'HubSpot', bg: '#FF7A59', text: '#ffffff' },

    // --- Databases ----------------------------------------------------------
    { match: /postgres|postgresql|aurora\s+postgres/i, label: 'PostgreSQL', bg: '#336791', text: '#ffffff' },
    { match: /mysql|mariadb/i, label: 'MySQL', bg: '#00758F', text: '#ffffff' },
    { match: /\bmongo(db)?\b/i, label: 'MongoDB', bg: '#13AA52', text: '#ffffff' },
    { match: /\bredis\b|elasticache/i, label: 'Redis', bg: '#DC382D', text: '#ffffff' },
    { match: /snowflake/i, label: 'Snowflake', bg: '#29B5E8', text: '#0b0f13' },
    { match: /databricks/i, label: 'Databricks', bg: '#FF3621', text: '#ffffff' },
    { match: /elasticsearch|opensearch/i, label: 'Elastic', bg: '#005571', text: '#ffffff' },
    { match: /cassandra/i, label: 'Cassandra', bg: '#1287B1', text: '#ffffff' },

    // --- Messaging ----------------------------------------------------------
    { match: /kafka|msk\b/i, label: 'Kafka', bg: '#231F20', text: '#ffffff' },
    { match: /rabbitmq/i, label: 'RabbitMQ', bg: '#FF6600', text: '#ffffff' },
    { match: /nats\b/i, label: 'NATS', bg: '#27AAE1', text: '#ffffff' },

    // --- Containers & runtimes ---------------------------------------------
    { match: /kubernetes|\bk8s\b|helm/i, label: 'Kubernetes', bg: '#326CE5', text: '#ffffff' },
    { match: /\bdocker\b/i, label: 'Docker', bg: '#2496ED', text: '#ffffff' },
    { match: /terraform/i, label: 'Terraform', bg: '#7B42BC', text: '#ffffff' },
    { match: /ansible/i, label: 'Ansible', bg: '#EE0000', text: '#ffffff' },

    // --- CI/CD & VCS --------------------------------------------------------
    { match: /github\s+actions|github/i, label: 'GitHub', bg: '#24292F', text: '#ffffff' },
    { match: /gitlab/i, label: 'GitLab', bg: '#FC6D26', text: '#ffffff' },
    { match: /jenkins/i, label: 'Jenkins', bg: '#D33833', text: '#ffffff' },
    { match: /circleci/i, label: 'CircleCI', bg: '#343434', text: '#ffffff' },
    { match: /argo\s*cd/i, label: 'Argo CD', bg: '#EF7B4D', text: '#0b0f13' },

    // --- Observability ------------------------------------------------------
    { match: /datadog/i, label: 'Datadog', bg: '#632CA6', text: '#ffffff' },
    { match: /new\s*relic/i, label: 'New Relic', bg: '#008C99', text: '#ffffff' },
    { match: /grafana/i, label: 'Grafana', bg: '#F46800', text: '#ffffff' },
    { match: /prometheus/i, label: 'Prometheus', bg: '#E6522C', text: '#ffffff' },
    { match: /splunk/i, label: 'Splunk', bg: '#F7931E', text: '#ffffff' },
    { match: /sentry/i, label: 'Sentry', bg: '#362D59', text: '#ffffff' },
    { match: /pagerduty/i, label: 'PagerDuty', bg: '#06AC38', text: '#ffffff' },

    // --- Auth / security ----------------------------------------------------
    { match: /auth0/i, label: 'Auth0', bg: '#EB5424', text: '#ffffff' },
    { match: /okta/i, label: 'Okta', bg: '#007DC1', text: '#ffffff' },
    { match: /hashicorp|\bvault\b/i, label: 'HashiCorp', bg: '#000000', text: '#ffffff' },
    { match: /keycloak/i, label: 'Keycloak', bg: '#008AAA', text: '#ffffff' },

    // --- Payments & comms --------------------------------------------------
    { match: /stripe/i, label: 'Stripe', bg: '#635BFF', text: '#ffffff' },
    { match: /paypal/i, label: 'PayPal', bg: '#003087', text: '#ffffff' },
    { match: /twilio/i, label: 'Twilio', bg: '#F22F46', text: '#ffffff' },
    { match: /sendgrid/i, label: 'SendGrid', bg: '#1A82E2', text: '#ffffff' },

    // --- Frontend -----------------------------------------------------------
    { match: /\breact\b(?!-?native)/i, label: 'React', bg: '#61DAFB', text: '#0b0f13' },
    { match: /next\.?js/i, label: 'Next.js', bg: '#000000', text: '#ffffff' },
    { match: /angular/i, label: 'Angular', bg: '#DD0031', text: '#ffffff' },
    { match: /vue\.?js|vuejs/i, label: 'Vue', bg: '#41B883', text: '#0b0f13' },
    { match: /flutter/i, label: 'Flutter', bg: '#02569B', text: '#ffffff' },

    // --- Runtimes / languages ----------------------------------------------
    { match: /node\.?js|nodejs/i, label: 'Node.js', bg: '#339933', text: '#ffffff' },
    { match: /spring\s*boot|\bspring\b/i, label: 'Spring', bg: '#6DB33F', text: '#ffffff' },
    { match: /\bdotnet\b|\.net|c#/i, label: '.NET', bg: '#512BD4', text: '#ffffff' },
    { match: /\bgo(lang)?\b/i, label: 'Go', bg: '#00ADD8', text: '#ffffff' },
    { match: /\brust\b/i, label: 'Rust', bg: '#CE412B', text: '#ffffff' },
];

export function detectTechBadge(label?: string, type?: string): TechBadge | null {
    const haystack = `${label ?? ''} ${type ?? ''}`.trim();
    if (!haystack) return null;
    return OFFICIAL_TECH_BADGES.find(item => item.match.test(haystack)) ?? null;
}
