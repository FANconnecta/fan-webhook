const HUBSPOT_BASE = "https://api.hubapi.com";

const STAGE_QUOTE_CALL = "6060237033";
const STAGE_REVIEW = "6060237034";

function matchStage(serviceName) {
  if (!serviceName) return null;
  const name = serviceName.toLowerCase();
  if (name.includes("quote")) {
    return { stageId: STAGE_QUOTE_CALL, entryRoute: "quote_call" };
  }
  if (name.includes("review")) {
    return { stageId: STAGE_REVIEW, entryRoute: "direct_review" };
  }
  return null;
}
function extractFields(body) {
  const email = body?.contact?.email ?? body?.email ?? null;
  const nameObj = body?.contact?.name ?? {};
  const firstName =
    nameObj.first ?? nameObj.given ?? nameObj.firstName ?? body?.firstName ?? "";
  const lastName =
    nameObj.last ?? nameObj.family ?? nameObj.lastName ?? body?.lastName ?? "";
  const phone =
    body?.booking_contact_phone ?? body?.contact?.phone ?? "";
  const serviceName = body?.service_name ?? body?.serviceName ?? null;
  const startDate =
    body?.start_time_timestamp_with_timezone ?? body?.start_date ?? null;
  return { email, firstName, lastName, phone, serviceName, startDate };
}
async function hubspotFetch(path, init) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function findContactByEmail(email) {
  const result = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      limit: 1,
    }),
  });
  return result.results?.[0] ?? null;
  async function upsertContact(fields) {
  const existing = await findContactByEmail(fields.email);
  const properties = {
    email: fields.email,
    firstname: fields.firstName,
    lastname: fields.lastName,
    phone: fields.phone,
  };

  if (existing) {
    return hubspotFetch(`/crm/v3/objects/contacts/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
  }
  return hubspotFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

async function createDeal(params) {
  const deal = await hubspotFetch("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        dealname: params.dealName,
        pipeline: "default",
        dealstage: params.stageId,
        entry_route: params.entryRoute,
      },
    }),
  });

  await hubspotFetch(
    `/crm/v3/objects/deals/${deal.id}/associations/contacts/${params.contactId}/deal_to_contact`,
    { method: "PUT" }
  );

  return deal;
  export async function POST(req) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.WIX_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, firstName, lastName, phone, serviceName, startDate } =
    extractFields(body);

  if (!email || !serviceName) {
    console.error("Missing email or service name. Raw body:", body);
    return Response.json(
      { error: "missing email or service name", received: body },
      { status: 400 }
    );
  }

  const mapping = matchStage(serviceName);
  if (!mapping) {
    console.error("Unrecognised service name:", serviceName);
    return Response.json(
      { error: "unrecognised service name", serviceName },
      { status: 400 }
    );
  }

  const contact = await upsertContact({ email, firstName, lastName, phone });
  const contactId = contact.id ?? contact?.results?.[0]?.id;

  const deal = await createDeal({
    contactId,
    stageId: mapping.stageId,
    entryRoute: mapping.entryRoute,
    dealName: `${firstName} ${lastName} - ${startDate ?? "booking"}`.trim(),
  });

  return Response.json({ ok: true, contactId, dealId: deal.id });
  }
}
}
