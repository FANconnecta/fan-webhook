const SERVICE_TO_STAGE = {
  "7571b5f2-d2cf-40b0-99ef-e35ab6ef20da": {
    stageId: "6060237033",
    entryRoute: "quote_call",
  },
  "8815cd30-c46e-4a70-92ea-b09debb40b20": {
    stageId: "6060237034",
    entryRoute: "direct_review",
  },
};

const HUBSPOT_BASE = "https://api.hubapi.com";

function extractFields(body) {
  const email = body?.contact?.email ?? body?.email ?? null;
  const firstName = body?.contact?.firstName ?? body?.firstName ?? "";
  const lastName = body?.contact?.lastName ?? body?.lastName ?? "";
  const phone = body?.contact?.phone ?? body?.phone ?? "";
  const serviceId = body?.booking?.serviceId ?? body?.serviceId ?? null;
  const startDate = body?.booking?.startDate ?? body?.startDate ?? null;
  return { email, firstName, lastName, phone, serviceId, startDate };
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
}

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
}

export async function POST(req) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.WIX_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, firstName, lastName, phone, serviceId, startDate } =
    extractFields(body);

  if (!email || !serviceId) {
    console.error("Wix webhook missing email or serviceId. Raw body:", body);
    return Response.json(
      { error: "missing email or serviceId", received: body },
      { status: 400 }
    );
  }

  const mapping = SERVICE_TO_STAGE[serviceId];
  if (!mapping) {
    console.error("Unrecognised Wix service ID:", serviceId);
    return Response.json(
      { error: "unrecognised service id", serviceId },
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
