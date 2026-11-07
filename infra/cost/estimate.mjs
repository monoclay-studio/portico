#!/usr/bin/env node
/**
 * Monthly cost ESTIMATE per tier from the unit prices in unit-prices-ap-south-1.json (AWS Price List, Nov 2026).
 *   node infra/cost/estimate.mjs            → markdown tables (pasted into infra/README.md § Cost per tier)
 *
 * Quantities are what the Terraform plans create (counted from `terraform test -verbose`) plus the usage assumptions
 * in USAGE below. No free tier, no credits, no taxes, on-demand prices. Re-check with the AWS Pricing Calculator
 * before authorizing spend: these are estimates, not quotes.
 */
import { readFileSync } from 'node:fs';

const { prices } = JSON.parse(
  readFileSync(new URL('./unit-prices-ap-south-1.json', import.meta.url), 'utf8'),
);
const p = (k) => {
  if (!(k in prices)) throw new Error(`unknown price ${k}`);
  return prices[k].usd;
};
const HOURS = 730; // AWS monthly convention
const OFFICE_HOURS = (12 * 6 * 52) / 12; // 08:00–20:00 Mon–Sat (cell default schedule) ≈ 312 h

/** Usage assumptions for ONE pilot hotel (stated in the README). */
const USAGE = {
  demo: { cfGb: 5, cfMillionReq: 0.5, logsGb: 1, ecrGb: 2, dnsMillion: 1 },
  pilot: { cfGb: 20, cfMillionReq: 2, logsGb: 3, ecrGb: 3, s3Gb: 10, lcu: 1, dbGb: 20, emails: 1000 },
  resilient: {
    logsGb: 8,
    s3Gb: 20,
    auroraGb: 10,
    auroraMillionIo: 30,
    natGb: 30,
    backupGb: 5,
    backupCopies: 30,
  },
};

const fargate = (vcpu, gb, tasks, hours = HOURS) =>
  tasks * hours * (vcpu * p('fargate_arm_vcpu_hour') + gb * p('fargate_arm_gb_hour'));

function demo(hours) {
  const u = USAGE.demo;
  return [
    ['EC2 t4g.small (api + worker + Postgres in Docker)', hours * p('ec2_t4g_small_hour')],
    ['EBS gp3 20 GB', 20 * p('ebs_gp3_gb_month')],
    ['Elastic IP (billed while stopped too)', HOURS * p('public_ipv4_hour')],
    [
      `CloudFront ${u.cfGb} GB + ${u.cfMillionReq}M HTTPS requests (India)`,
      u.cfGb * p('cloudfront_in_gb') + u.cfMillionReq * 100 * p('cloudfront_in_https_10k'),
    ],
    ['KMS key (logs + on-call topic)', p('kms_key_month')],
    [
      'CloudWatch: 7 alarms, 7 log-derived metrics, 1 GB logs',
      7 * p('alarm_month') +
        7 * p('custom_metric_month') +
        u.logsGb * (p('logs_ingest_gb') + p('logs_storage_gb_month')),
    ],
    ['DNS Firewall (external-effect providers blocked)', u.dnsMillion * p('dns_firewall_million')],
    ['ECR 2 GB', u.ecrGb * p('ecr_gb_month')],
    ['AWS Budgets (1 budget, 2 actions)', 0],
  ];
}

function managedCommon(u, { albAzs, waf, kms, alarms, secrets, logsGb, s3Gb }) {
  return [
    ['ALB (hours + 1 LCU average)', HOURS * (p('alb_hour') + u.lcu * p('alb_lcu_hour'))],
    [`ALB public IPv4 × ${albAzs}`, albAzs * HOURS * p('public_ipv4_hour')],
    [
      `CloudFront ${u.cfGb} GB + ${u.cfMillionReq}M HTTPS requests (India)`,
      u.cfGb * p('cloudfront_in_gb') + u.cfMillionReq * 100 * p('cloudfront_in_https_10k'),
    ],
    [
      `WAF ${waf.level} (web ACL + ${waf.rules} rules + ${u.cfMillionReq}M requests)`,
      p('waf_web_acl_month') + waf.rules * p('waf_rule_month') + u.cfMillionReq * p('waf_million_requests'),
    ],
    [`Secrets Manager × ${secrets}`, secrets * p('secret_month')],
    [`KMS keys × ${kms}`, kms * p('kms_key_month')],
    [
      `CloudWatch: ${alarms} alarms, 7 log-derived metrics, ${logsGb} GB logs`,
      alarms * p('alarm_month') +
        7 * p('custom_metric_month') +
        logsGb * (p('logs_ingest_gb') + p('logs_storage_gb_month')),
    ],
    ['Route 53 HTTPS health check (external)', p('route53_https_check_month')],
    [`S3 ${s3Gb} GB (documents, exports, backups, logs)`, s3Gb * p('s3_gb_month')],
    [`ECR ${u.ecrGb} GB`, u.ecrGb * p('ecr_gb_month')],
    [`SES ${u.emails} emails`, u.emails * p('ses_email')],
  ];
}

function lean() {
  const u = USAGE.pilot;
  return [
    ['Fargate ARM: api 0.5 vCPU/1 GB + worker 0.25 vCPU/0.5 GB', fargate(0.5, 1, 1) + fargate(0.25, 0.5, 1)],
    ['Task public IPv4 × 2 (egress without NAT)', 2 * HOURS * p('public_ipv4_hour')],
    ['RDS PostgreSQL db.t4g.small Single-AZ', HOURS * p('rds_pg_t4g_small_hour')],
    [
      `RDS gp3 ${u.dbGb} GB (backups + 14-day PITR within the free allocation)`,
      u.dbGb * p('rds_gp3_gb_month'),
    ],
    ['Monthly restore drill (1 h restore + Fargate minutes)', p('rds_pg_t4g_small_hour') + 0.1],
    ...managedCommon(u, {
      albAzs: 2,
      waf: { level: 'basic', rules: 3 },
      kms: 5,
      alarms: 17,
      secrets: 15,
      logsGb: u.logsGb,
      s3Gb: u.s3Gb,
    }),
  ];
}

function resilient(acuPerInstance) {
  const u = USAGE.pilot;
  const r = USAGE.resilient;
  const database =
    acuPerInstance === 'rds-multi-az'
      ? [
          [
            'RDS PostgreSQL db.t4g.small Multi-AZ (synchronous standby, automatic failover)',
            HOURS * p('rds_pg_t4g_small_multiaz_hour'),
          ],
          [`RDS Multi-AZ gp3 ${u.dbGb} GB`, u.dbGb * p('rds_multiaz_gp3_gb_month')],
        ]
      : [
          [
            `Aurora Serverless v2: writer + reader at ${acuPerInstance} ACU each`,
            2 * acuPerInstance * HOURS * p('aurora_serverless_v2_acu_hour'),
          ],
          [
            `Aurora storage ${r.auroraGb} GB + ${r.auroraMillionIo}M I/O`,
            r.auroraGb * p('aurora_storage_gb_month') + r.auroraMillionIo * p('aurora_io_million'),
          ],
        ];
  return [
    [
      'Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB)',
      fargate(0.5, 1, 2) + fargate(0.25, 0.5, 2),
    ],
    ['NAT gateway × 3 (one per AZ)', 3 * HOURS * p('nat_gateway_hour')],
    ['NAT Elastic IP × 3', 3 * HOURS * p('public_ipv4_hour')],
    [`NAT data processing ${r.natGb} GB`, r.natGb * p('nat_gateway_gb')],
    ...database,
    [
      `AWS Backup cross-region copies (${r.backupGb} GB × ${r.backupCopies} daily copies transferred + DR storage)`,
      r.backupGb * r.backupCopies * p('backup_xregion_aurora_gb') +
        r.backupGb * 35 * p('aurora_backup_gb_month'),
    ],
    ['Monthly restore drill (Aurora db.t4g.medium 1 h + Fargate minutes)', p('aurora_t4g_medium_hour') + 0.2],
    ...managedCommon(u, {
      albAzs: 3,
      waf: { level: 'full', rules: 6 },
      kms: 7,
      alarms: 19,
      secrets: 18,
      logsGb: r.logsGb,
      s3Gb: r.s3Gb,
    }),
    ['Container Insights + enhanced monitoring (metrics/logs)', 5],
  ];
}

function staging(mode) {
  const ecr = USAGE.pilot.ecrGb * p('ecr_gb_month');
  if (mode === 'off')
    return [['ECR images kept for the next release (VPC, S3 gateway endpoint, budget: $0)', ecr]];
  const full = lean().filter(([name]) => !name.startsWith('ECR') && !name.startsWith('Monthly restore'));
  const monthly = full.reduce((s, [, v]) => s + v, 0);
  if (mode === 'rehearsal')
    return [
      ['Lean cell active 2 days for a release rehearsal (prorated hourly)', (monthly * 48) / HOURS],
      ['ECR', ecr],
    ];
  // Always on, Fargate scaled to zero outside office hours; database, ALB, WAF, secrets run all month.
  const fargateFull = full.find(([n]) => n.startsWith('Fargate'))[1];
  const ipv4 = full.find(([n]) => n.startsWith('Task public IPv4'))[1];
  return [
    [
      'Lean cell always on, tasks scaled to zero outside office hours',
      monthly - fargateFull - ipv4 + ((fargateFull + ipv4) * OFFICE_HOURS) / HOURS,
    ],
    ['ECR', ecr],
  ];
}

const sum = (rows) => rows.reduce((s, [, v]) => s + v, 0);
const money = (v) => (v < 0.005 ? '$0' : `$${v.toFixed(2)}`);
function table(title, rows) {
  const lines = [
    `**${title}** — ≈ **${money(sum(rows))}/month**`,
    '',
    '| Line item | $/month |',
    '|---|---:|',
  ];
  for (const [name, v] of rows) lines.push(`| ${name} | ${money(v)} |`);
  return lines.join('\n');
}

const out = [
  table('T1 demo — office hours (Mon–Sat 08:00–20:00 Malé)', demo(OFFICE_HOURS)),
  table('T1 demo — always on', demo(HOURS)),
  table('T2 lean — production pilot', lean()),
  table('T2 staging — off between releases (default)', staging('off')),
  table('T2 staging — one 2-day release rehearsal', staging('rehearsal')),
  table('T2/T3 staging — always on with office-hours scaling', staging('office')),
  table('T3 resilient — production, quiet (Aurora at its 0.5 ACU floor)', resilient(0.5)),
  table('T3 resilient — production, busy (Aurora averaging 1 ACU per instance)', resilient(1)),
  table(
    'T3 variant — resilient with RDS Multi-AZ instead of Aurora (overrides: db_engine = "rds", db_multi_az = true)',
    resilient('rds-multi-az'),
  ),
];
process.stdout.write(`${out.join('\n\n')}\n`);
