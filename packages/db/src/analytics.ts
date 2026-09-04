import type { DbClient } from "./auth.js";

export interface AnalyticsOverviewMetrics {
  totalConversations: number;
  openConversations: number;
  assignedConversations: number;
  resolvedConversations: number;
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  botMessages: number;
  humanMessages: number;
  botAutomationRate: number;
  slaMetPercentage: number;
  avgFirstResponseTimeSeconds: number;
  avgResolutionTimeSeconds: number;
}

export interface VolumeTimeSeriesPoint {
  date: string;
  inbound: number;
  outbound: number;
  bot: number;
}

export async function aggregateHourlyMetricsForOrg(
  db: DbClient,
  organizationId: string,
  since?: Date
): Promise<number> {
  const startTime = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Hourly message metrics
  const msgHourly = await db.query<{
    bucket: Date;
    inbound: string;
    outbound: string;
    bot: string;
    human: string;
  }>(
    `SELECT
      date_trunc('hour', created_at) AS bucket,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
      COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
      COUNT(*) FILTER (WHERE sender_type = 'bot') AS bot,
      COUNT(*) FILTER (WHERE sender_type IN ('agent', 'customer')) AS human
     FROM flowdesk.messages
     WHERE organization_id = $1 AND created_at >= $2
     GROUP BY 1`,
    [organizationId, startTime]
  );

  // 2. Hourly conversation creation & resolution metrics
  const convHourly = await db.query<{
    bucket: Date;
    created_count: string;
    resolved_count: string;
    frt_count: string;
    frt_total_seconds: string;
    res_count: string;
    res_total_seconds: string;
    sla_met: string;
    sla_breach: string;
  }>(
    `SELECT
      date_trunc('hour', created_at) AS bucket,
      COUNT(*) AS created_count,
      COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) AS resolved_count,
      COUNT(*) FILTER (WHERE first_responded_at IS NOT NULL) AS frt_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (first_responded_at - created_at))) FILTER (WHERE first_responded_at IS NOT NULL), 0)::bigint AS frt_total_seconds,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS res_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (resolved_at - created_at))) FILTER (WHERE resolved_at IS NOT NULL), 0)::bigint AS res_total_seconds,
      COUNT(*) FILTER (WHERE (first_response_due_at IS NULL OR first_responded_at <= first_response_due_at)
                         AND (resolution_due_at IS NULL OR resolved_at <= resolution_due_at)) AS sla_met,
      COUNT(*) FILTER (WHERE (first_response_due_at IS NOT NULL AND (first_responded_at IS NULL AND clock_timestamp() > first_response_due_at OR first_responded_at > first_response_due_at))
                          OR (resolution_due_at IS NOT NULL AND (resolved_at IS NULL AND clock_timestamp() > resolution_due_at OR resolved_at > resolution_due_at))) AS sla_breach
     FROM flowdesk.conversations
     WHERE organization_id = $1 AND created_at >= $2
     GROUP BY 1`,
    [organizationId, startTime]
  );

  const bucketMap = new Map<
    string,
    {
      bucketStart: Date;
      inbound: number;
      outbound: number;
      bot: number;
      human: number;
      created: number;
      resolved: number;
      frtCount: number;
      frtTotalSeconds: number;
      resCount: number;
      resTotalSeconds: number;
      slaMet: number;
      slaBreach: number;
    }
  >();

  for (const m of msgHourly.rows) {
    const key = new Date(m.bucket).toISOString();
    bucketMap.set(key, {
      bucketStart: new Date(m.bucket),
      inbound: parseInt(m.inbound, 10) || 0,
      outbound: parseInt(m.outbound, 10) || 0,
      bot: parseInt(m.bot, 10) || 0,
      human: parseInt(m.human, 10) || 0,
      created: 0,
      resolved: 0,
      frtCount: 0,
      frtTotalSeconds: 0,
      resCount: 0,
      resTotalSeconds: 0,
      slaMet: 0,
      slaBreach: 0
    });
  }

  for (const c of convHourly.rows) {
    const key = new Date(c.bucket).toISOString();
    const existing = bucketMap.get(key) ?? {
      bucketStart: new Date(c.bucket),
      inbound: 0,
      outbound: 0,
      bot: 0,
      human: 0,
      created: 0,
      resolved: 0,
      frtCount: 0,
      frtTotalSeconds: 0,
      resCount: 0,
      resTotalSeconds: 0,
      slaMet: 0,
      slaBreach: 0
    };
    existing.created = parseInt(c.created_count, 10) || 0;
    existing.resolved = parseInt(c.resolved_count, 10) || 0;
    existing.frtCount = parseInt(c.frt_count, 10) || 0;
    existing.frtTotalSeconds = parseInt(c.frt_total_seconds, 10) || 0;
    existing.resCount = parseInt(c.res_count, 10) || 0;
    existing.resTotalSeconds = parseInt(c.res_total_seconds, 10) || 0;
    existing.slaMet = parseInt(c.sla_met, 10) || 0;
    existing.slaBreach = parseInt(c.sla_breach, 10) || 0;
    bucketMap.set(key, existing);
  }

  let upsertedCount = 0;
  for (const item of bucketMap.values()) {
    await db.query(
      `INSERT INTO flowdesk.analytics_aggregates_hourly (
        organization_id, bucket_start, inbound_count, outbound_count, bot_count, human_count,
        conversations_created, conversations_resolved, first_response_count, first_response_total_seconds,
        resolution_count, resolution_total_seconds, sla_met_count, sla_breach_count, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, clock_timestamp())
      ON CONFLICT (organization_id, bucket_start) DO UPDATE SET
        inbound_count = EXCLUDED.inbound_count,
        outbound_count = EXCLUDED.outbound_count,
        bot_count = EXCLUDED.bot_count,
        human_count = EXCLUDED.human_count,
        conversations_created = EXCLUDED.conversations_created,
        conversations_resolved = EXCLUDED.conversations_resolved,
        first_response_count = EXCLUDED.first_response_count,
        first_response_total_seconds = EXCLUDED.first_response_total_seconds,
        resolution_count = EXCLUDED.resolution_count,
        resolution_total_seconds = EXCLUDED.resolution_total_seconds,
        sla_met_count = EXCLUDED.sla_met_count,
        sla_breach_count = EXCLUDED.sla_breach_count,
        updated_at = clock_timestamp()`,
      [
        organizationId,
        item.bucketStart,
        item.inbound,
        item.outbound,
        item.bot,
        item.human,
        item.created,
        item.resolved,
        item.frtCount,
        item.frtTotalSeconds,
        item.resCount,
        item.resTotalSeconds,
        item.slaMet,
        item.slaBreach
      ]
    );
    upsertedCount++;
  }

  await db.query(
    `INSERT INTO flowdesk.analytics_watermarks (organization_id, last_aggregated_at, updated_at)
     VALUES ($1, clock_timestamp(), clock_timestamp())
     ON CONFLICT (organization_id) DO UPDATE
       SET last_aggregated_at = clock_timestamp(), updated_at = clock_timestamp()`,
    [organizationId]
  );

  return upsertedCount;
}

export async function getAnalyticsOverview(
  db: DbClient,
  organizationId: string,
  days = 30
): Promise<AnalyticsOverviewMetrics> {
  // Check if aggregate data is present
  const aggRes = await db.query<{
    inbound: string;
    outbound: string;
    bot: string;
    human: string;
    created: string;
    resolved: string;
    frt_count: string;
    frt_seconds: string;
    res_count: string;
    res_seconds: string;
    sla_met: string;
    sla_breach: string;
  }>(
    `SELECT
      COALESCE(SUM(inbound_count), 0) AS inbound,
      COALESCE(SUM(outbound_count), 0) AS outbound,
      COALESCE(SUM(bot_count), 0) AS bot,
      COALESCE(SUM(human_count), 0) AS human,
      COALESCE(SUM(conversations_created), 0) AS created,
      COALESCE(SUM(conversations_resolved), 0) AS resolved,
      COALESCE(SUM(first_response_count), 0) AS frt_count,
      COALESCE(SUM(first_response_total_seconds), 0) AS frt_seconds,
      COALESCE(SUM(resolution_count), 0) AS res_count,
      COALESCE(SUM(resolution_total_seconds), 0) AS res_seconds,
      COALESCE(SUM(sla_met_count), 0) AS sla_met,
      COALESCE(SUM(sla_breach_count), 0) AS sla_breach
     FROM flowdesk.analytics_aggregates_hourly
     WHERE organization_id = $1 AND bucket_start >= clock_timestamp() - ($2 || ' days')::interval`,
    [organizationId, days]
  );

  const aggRow = aggRes.rows[0];
  const aggTotalMsg = aggRow
    ? (parseInt(aggRow.inbound, 10) || 0) + (parseInt(aggRow.outbound, 10) || 0)
    : 0;

  // If aggregate table has data, combine with live conversation status counts
  if (aggRow && aggTotalMsg > 0) {
    const liveConvRes = await db.query<{
      total: string;
      open: string;
      assigned: string;
      resolved: string;
    }>(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE assigned_to_user_id IS NOT NULL OR team_id IS NOT NULL) AS assigned,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) AS resolved
       FROM flowdesk.conversations
       WHERE organization_id = $1 AND created_at >= clock_timestamp() - ($2 || ' days')::interval`,
      [organizationId, days]
    );
    const liveRow = liveConvRes.rows[0] ?? {
      total: aggRow.created,
      open: "0",
      assigned: "0",
      resolved: aggRow.resolved
    };

    const inbound = parseInt(aggRow.inbound, 10) || 0;
    const outbound = parseInt(aggRow.outbound, 10) || 0;
    const bot = parseInt(aggRow.bot, 10) || 0;
    const human = parseInt(aggRow.human, 10) || 0;
    const totalMsg = inbound + outbound;

    const frtCount = parseInt(aggRow.frt_count, 10) || 0;
    const frtSeconds = parseInt(aggRow.frt_seconds, 10) || 0;
    const resCount = parseInt(aggRow.res_count, 10) || 0;
    const resSeconds = parseInt(aggRow.res_seconds, 10) || 0;

    const slaMet = parseInt(aggRow.sla_met, 10) || 0;
    const slaBreach = parseInt(aggRow.sla_breach, 10) || 0;
    const slaTotal = slaMet + slaBreach;

    return {
      totalConversations: parseInt(liveRow.total, 10) || 0,
      openConversations: parseInt(liveRow.open, 10) || 0,
      assignedConversations: parseInt(liveRow.assigned, 10) || 0,
      resolvedConversations: parseInt(liveRow.resolved, 10) || 0,
      totalMessages: totalMsg,
      inboundMessages: inbound,
      outboundMessages: outbound,
      botMessages: bot,
      humanMessages: human,
      botAutomationRate: totalMsg > 0 ? Math.round((bot / totalMsg) * 1000) / 10 : 0,
      slaMetPercentage: slaTotal > 0 ? Math.round((slaMet / slaTotal) * 1000) / 10 : 100.0,
      avgFirstResponseTimeSeconds: frtCount > 0 ? Math.round(frtSeconds / frtCount) : 0,
      avgResolutionTimeSeconds: resCount > 0 ? Math.round(resSeconds / resCount) : 0
    };
  }

  // Fallback to real transactional scan
  const convRes = await db.query<{
    total: string;
    open: string;
    assigned: string;
    resolved: string;
    frt_count: string;
    frt_seconds: string;
    res_count: string;
    res_seconds: string;
    sla_met: string;
    sla_breach: string;
  }>(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'open') AS open,
      COUNT(*) FILTER (WHERE assigned_to_user_id IS NOT NULL OR team_id IS NOT NULL) AS assigned,
      COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) AS resolved,
      COUNT(*) FILTER (WHERE first_responded_at IS NOT NULL) AS frt_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (first_responded_at - created_at))) FILTER (WHERE first_responded_at IS NOT NULL), 0)::bigint AS frt_seconds,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS res_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (resolved_at - created_at))) FILTER (WHERE resolved_at IS NOT NULL), 0)::bigint AS res_seconds,
      COUNT(*) FILTER (WHERE (first_response_due_at IS NULL OR first_responded_at <= first_response_due_at)
                         AND (resolution_due_at IS NULL OR resolved_at <= resolution_due_at)) AS sla_met,
      COUNT(*) FILTER (WHERE (first_response_due_at IS NOT NULL AND (first_responded_at IS NULL AND clock_timestamp() > first_response_due_at OR first_responded_at > first_response_due_at))
                          OR (resolution_due_at IS NOT NULL AND (resolved_at IS NULL AND clock_timestamp() > resolution_due_at OR resolved_at > resolution_due_at))) AS sla_breach
     FROM flowdesk.conversations
     WHERE organization_id = $1 AND created_at >= clock_timestamp() - ($2 || ' days')::interval`,
    [organizationId, days]
  );

  const msgRes = await db.query<{
    total: string;
    inbound: string;
    outbound: string;
    bot: string;
    human: string;
  }>(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
      COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
      COUNT(*) FILTER (WHERE sender_type = 'bot') AS bot,
      COUNT(*) FILTER (WHERE sender_type IN ('agent', 'customer')) AS human
     FROM flowdesk.messages
     WHERE organization_id = $1 AND created_at >= clock_timestamp() - ($2 || ' days')::interval`,
    [organizationId, days]
  );

  const convRow = convRes.rows[0] ?? {
    total: "0",
    open: "0",
    assigned: "0",
    resolved: "0",
    frt_count: "0",
    frt_seconds: "0",
    res_count: "0",
    res_seconds: "0",
    sla_met: "0",
    sla_breach: "0"
  };
  const msgRow = msgRes.rows[0] ?? {
    total: "0",
    inbound: "0",
    outbound: "0",
    bot: "0",
    human: "0"
  };

  const totalConv = parseInt(convRow.total, 10) || 0;
  const openConv = parseInt(convRow.open, 10) || 0;
  const assignedConv = parseInt(convRow.assigned, 10) || 0;
  const resolvedConv = parseInt(convRow.resolved, 10) || 0;

  const totalMsg = parseInt(msgRow.total, 10) || 0;
  const inboundMsg = parseInt(msgRow.inbound, 10) || 0;
  const outboundMsg = parseInt(msgRow.outbound, 10) || 0;
  const botMsg = parseInt(msgRow.bot, 10) || 0;
  const humanMsg = parseInt(msgRow.human, 10) || 0;

  const botAutomationRate = totalMsg > 0 ? Math.round((botMsg / totalMsg) * 1000) / 10 : 0;

  const frtCount = parseInt(convRow.frt_count, 10) || 0;
  const frtSeconds = parseInt(convRow.frt_seconds, 10) || 0;
  const resCount = parseInt(convRow.res_count, 10) || 0;
  const resSeconds = parseInt(convRow.res_seconds, 10) || 0;

  const slaMet = parseInt(convRow.sla_met, 10) || 0;
  const slaBreach = parseInt(convRow.sla_breach, 10) || 0;
  const slaTotal = slaMet + slaBreach;

  return {
    totalConversations: totalConv,
    openConversations: openConv,
    assignedConversations: assignedConv,
    resolvedConversations: resolvedConv,
    totalMessages: totalMsg,
    inboundMessages: inboundMsg,
    outboundMessages: outboundMsg,
    botMessages: botMsg,
    humanMessages: humanMsg,
    botAutomationRate,
    slaMetPercentage: slaTotal > 0 ? Math.round((slaMet / slaTotal) * 1000) / 10 : 100.0,
    avgFirstResponseTimeSeconds: frtCount > 0 ? Math.round(frtSeconds / frtCount) : 0,
    avgResolutionTimeSeconds: resCount > 0 ? Math.round(resSeconds / resCount) : 0
  };
}

export async function getVolumeTimeSeries(
  db: DbClient,
  organizationId: string,
  days = 7
): Promise<VolumeTimeSeriesPoint[]> {
  // Check if aggregate hourly table has data
  const aggRes = await db.query<{
    day: string;
    inbound: string;
    outbound: string;
    bot: string;
  }>(
    `SELECT
      to_char(date_trunc('day', bucket_start), 'YYYY-MM-DD') AS day,
      SUM(inbound_count) AS inbound,
      SUM(outbound_count) AS outbound,
      SUM(bot_count) AS bot
     FROM flowdesk.analytics_aggregates_hourly
     WHERE organization_id = $1 AND bucket_start >= clock_timestamp() - ($2 || ' days')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [organizationId, days]
  );

  if (aggRes.rows.length > 0) {
    return aggRes.rows.map((r) => ({
      date: r.day,
      inbound: parseInt(r.inbound, 10) || 0,
      outbound: parseInt(r.outbound, 10) || 0,
      bot: parseInt(r.bot, 10) || 0
    }));
  }

  // Fallback to transactional table
  const res = await db.query<{
    day: string;
    inbound: string;
    outbound: string;
    bot: string;
  }>(
    `SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
      COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
      COUNT(*) FILTER (WHERE sender_type = 'bot') AS bot
     FROM flowdesk.messages
     WHERE organization_id = $1 AND created_at >= clock_timestamp() - ($2 || ' days')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [organizationId, days]
  );

  return res.rows.map((r) => ({
    date: r.day,
    inbound: parseInt(r.inbound, 10) || 0,
    outbound: parseInt(r.outbound, 10) || 0,
    bot: parseInt(r.bot, 10) || 0
  }));
}
