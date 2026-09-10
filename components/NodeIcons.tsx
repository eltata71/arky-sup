import React from 'react';
import {
    User, Users, UserCog,
    Database, HardDrive,
    Cloud, CloudCog,
    Server, Cpu,
    Globe, Network, Waypoints,
    Monitor, AppWindow, Layout,
    Smartphone, Tablet,
    Boxes, Package,
    ListOrdered, Zap, Workflow,
    Shield, ShieldCheck, Lock, Key, KeyRound,
    Router, Wifi, Radio,
    Archive,
    GitBranch, Rocket, Play,
    Activity, BarChart3, Bell, Eye,
    Box, Layers, Container,
    Plug, Link, Cable,
    FileText, FileCode, ScrollText,
    ExternalLink, Building2, Landmark,
    Table2, Rows3,
    Settings, Cog, Wrench,
    Mail, MessageSquare, Send,
    CreditCard, DollarSign, Receipt,
    Clock, Timer, Calendar,
    Search, Filter, SlidersHorizontal,
    CheckCircle2, AlertTriangle, XCircle, Info,
    ArrowRightLeft, Repeat, RefreshCw,
    Blocks, Component, CircuitBoard,
    type LucideProps
} from 'lucide-react';

interface IconRule {
    keywords: string[];
    icon: React.FC<LucideProps>;
}

// Ordered by specificity — more specific keywords first
const ICON_RULES: IconRule[] = [
    // --- Cloud Providers & Infrastructure ---
    { keywords: ['kubernetes', 'k8s', 'helm'], icon: Layers },
    { keywords: ['docker', 'pod', 'container'], icon: Container },
    { keywords: ['serverless', 'lambda', 'function', 'faas'], icon: Zap },
    { keywords: ['aws', 'azure', 'gcp', 'cloud', 'saas', 'iaas', 'paas'], icon: Cloud },
    { keywords: ['cdn', 'cloudfront', 'akamai'], icon: CloudCog },

    // --- Security ---
    { keywords: ['firewall', 'waf', 'ids', 'ips'], icon: ShieldCheck },
    { keywords: ['oauth', 'iam', 'sso', 'auth', 'identity'], icon: KeyRound },
    { keywords: ['ssl', 'tls', 'certificate', 'encrypt'], icon: Lock },
    { keywords: ['security', 'shield', 'protection', 'compliance'], icon: Shield },
    { keywords: ['secret', 'vault', 'credential', 'key'], icon: Key },

    // --- Databases & Storage ---
    { keywords: ['postgresql', 'mysql', 'mariadb', 'oracle', 'sql-server', 'sql'], icon: Database },
    { keywords: ['mongodb', 'dynamodb', 'cosmosdb', 'nosql', 'mongo'], icon: Database },
    { keywords: ['redis', 'memcached', 'cache', 'elasticache'], icon: HardDrive },
    { keywords: ['s3', 'blob', 'bucket', 'storage', 'file-store'], icon: Archive },
    { keywords: ['database', 'db', 'data-store', 'store', 'repository', 'base de datos', 'almacén de datos', 'almacen de datos', 'repositorio'], icon: Database },

    // --- Messaging & Events ---
    { keywords: ['kafka', 'rabbitmq', 'activemq', 'nats', 'pulsar'], icon: Zap },
    { keywords: ['sqs', 'sns', 'queue', 'mq', 'message-queue'], icon: ListOrdered },
    { keywords: ['event-bus', 'event', 'bus', 'topic', 'pub-sub', 'stream'], icon: Radio },

    // --- Networking ---
    { keywords: ['load-balancer', 'lb', 'alb', 'nlb', 'elb', 'balancer'], icon: ArrowRightLeft },
    { keywords: ['dns', 'route53', 'domain'], icon: Globe },
    { keywords: ['vpc', 'subnet', 'vnet', 'network', 'vlan'], icon: Network },
    { keywords: ['router', 'switch', 'gateway-network'], icon: Router },
    { keywords: ['wifi', 'wireless', 'iot'], icon: Wifi },

    // --- API & Gateway ---
    { keywords: ['api-gateway', 'gateway', 'proxy', 'reverse-proxy', 'envoy', 'nginx', 'kong'], icon: Waypoints },
    { keywords: ['graphql', 'apollo'], icon: CircuitBoard },
    { keywords: ['rest', 'api', 'endpoint', 'webhook', 'openapi'], icon: Globe },

    // --- CI/CD & DevOps ---
    { keywords: ['pipeline', 'ci/cd', 'ci', 'cd', 'jenkins', 'github-actions', 'gitlab-ci'], icon: GitBranch },
    { keywords: ['deploy', 'release', 'rollout', 'deployment'], icon: Rocket },
    { keywords: ['build', 'compile', 'artifact'], icon: Play },

    // --- Monitoring & Observability ---
    { keywords: ['monitoring', 'prometheus', 'grafana', 'datadog', 'metrics'], icon: Activity },
    { keywords: ['logging', 'log', 'elk', 'splunk', 'fluentd'], icon: BarChart3 },
    { keywords: ['alert', 'alarm', 'notification', 'pagerduty'], icon: Bell },
    { keywords: ['observability', 'tracing', 'jaeger', 'zipkin', 'opentelemetry'], icon: Eye },

    // --- Frontend & Mobile ---
    { keywords: ['mobile', 'ios', 'android', 'phone', 'react-native', 'flutter'], icon: Smartphone },
    { keywords: ['tablet', 'ipad'], icon: Tablet },
    { keywords: ['web', 'browser', 'frontend', 'spa', 'react', 'angular', 'vue', 'nextjs'], icon: Monitor },
    { keywords: ['desktop', 'electron', 'app-window'], icon: AppWindow },
    { keywords: ['ui', 'layout', 'dashboard', 'portal'], icon: Layout },

    // --- People & Actors ---
    { keywords: ['admin', 'administrator', 'superadmin', 'operator', 'administrador'], icon: UserCog },
    { keywords: ['team', 'group', 'organization', 'users', 'stakeholders'], icon: Users },
    { keywords: ['person', 'actor', 'user', 'cliente', 'customer', 'stakeholder', 'human', 'asegurado', 'prescriptor', 'médico', 'medico', 'paciente', 'corredor'], icon: User },

    // --- Services & Microservices ---
    { keywords: ['microservice', 'micro-service', 'service-mesh', 'istio'], icon: Boxes },
    { keywords: ['module', 'component', 'plugin', 'extension'], icon: Component },
    { keywords: ['service', 'backend', 'server', 'host', 'instance', 'node'], icon: Server },
    { keywords: ['processor', 'compute', 'cpu', 'worker'], icon: Cpu },

    // --- Integration & Middleware ---
    { keywords: ['adapter', 'connector', 'bridge', 'middleware', 'integration'], icon: Plug },
    { keywords: ['etl', 'transform', 'pipeline-data', 'data-flow'], icon: RefreshCw },
    { keywords: ['link', 'connection', 'interface'], icon: Link },
    { keywords: ['cable', 'wire', 'channel'], icon: Cable },

    // --- Communication ---
    { keywords: ['email', 'mail', 'smtp', 'ses', 'amazon ses'], icon: Mail },
    { keywords: ['chat', 'messaging', 'slack', 'teams', 'notification-service', 'notificaciones', 'notificación'], icon: MessageSquare },
    { keywords: ['sms', 'push', 'send'], icon: Send },

    // --- Business & Finance ---
    { keywords: ['payment', 'billing', 'stripe', 'paypal'], icon: CreditCard },
    { keywords: ['finance', 'accounting', 'cost', 'pricing'], icon: DollarSign },
    { keywords: ['invoice', 'receipt', 'order'], icon: Receipt },

    // --- Scheduling & Time ---
    { keywords: ['scheduler', 'cron', 'timer', 'schedule'], icon: Timer },
    { keywords: ['clock', 'time', 'timeout'], icon: Clock },
    { keywords: ['calendar', 'date', 'planning'], icon: Calendar },

    // --- Search & Discovery ---
    { keywords: ['search', 'elasticsearch', 'solr', 'opensearch'], icon: Search },
    { keywords: ['filter', 'query', 'criteria'], icon: Filter },
    { keywords: ['config', 'configuration', 'settings', 'preference'], icon: SlidersHorizontal },

    // --- Documents & Data Models ---
    { keywords: ['document', 'specification', 'contract', 'schema', 'spec'], icon: FileText },
    { keywords: ['code', 'script', 'source', 'repository-code'], icon: FileCode },
    { keywords: ['readme', 'documentation', 'manual', 'guide'], icon: ScrollText },
    { keywords: ['table', 'entity', 'model', 'record'], icon: Table2 },
    { keywords: ['data', 'dataset', 'row', 'column'], icon: Rows3 },

    // --- External Systems ---
    { keywords: ['external', 'third-party', '3rd-party', 'vendor', 'externo', 'sistema externo', 'proveedor externo'], icon: ExternalLink },
    { keywords: ['erp', 'sap', 'oracle-erp', 'dynamics'], icon: Building2 },
    { keywords: ['crm', 'salesforce', 'hubspot'], icon: Building2 },
    { keywords: ['legacy', 'mainframe', 'cobol', 'sistema legacy', 'as400', 'iseries'], icon: Landmark },
    { keywords: ['integración', 'integracion', 'integration-platform', 'mulesoft', 'esb', 'ipaas'], icon: Plug },

    // --- Status & States ---
    { keywords: ['success', 'complete', 'active', 'healthy'], icon: CheckCircle2 },
    { keywords: ['warning', 'degraded', 'slow'], icon: AlertTriangle },
    { keywords: ['error', 'failed', 'down', 'critical'], icon: XCircle },
    { keywords: ['info', 'status', 'state'], icon: Info },

    // --- Tools & Config ---
    { keywords: ['tool', 'utility', 'helper'], icon: Wrench },
    { keywords: ['setting', 'gear', 'cog'], icon: Cog },
    { keywords: ['system', 'platform', 'infrastructure'], icon: Settings },

    // --- Process & Workflow ---
    { keywords: ['process', 'workflow', 'bpmn', 'flow', 'orchestration'], icon: Workflow },
    { keywords: ['sync', 'synchronize', 'replicate'], icon: Repeat },

    // --- Containers & Packages ---
    { keywords: ['package', 'library', 'dependency', 'npm', 'maven'], icon: Package },
    { keywords: ['namespace', 'scope', 'boundary', 'context'], icon: Box },
    { keywords: ['block', 'unit', 'piece'], icon: Blocks },
];

// Fallback icon
const DEFAULT_ICON = Server;

export const getNodeIcon = (type: string, size = 6): React.ReactElement => {
    const sizeClass = `w-${size} h-${size}`;
    const t = (type || '').toLowerCase();

    for (const rule of ICON_RULES) {
        for (const keyword of rule.keywords) {
            if (t.includes(keyword)) {
                const Icon = rule.icon;
                return <Icon className={sizeClass} />;
            }
        }
    }

    return <DEFAULT_ICON className={sizeClass} />;
};

// Get icon component by type (for use when you need the component itself)
export const getNodeIconComponent = (type: string): React.FC<LucideProps> => {
    const t = (type || '').toLowerCase();

    for (const rule of ICON_RULES) {
        for (const keyword of rule.keywords) {
            if (t.includes(keyword)) {
                return rule.icon;
            }
        }
    }

    return DEFAULT_ICON;
};
