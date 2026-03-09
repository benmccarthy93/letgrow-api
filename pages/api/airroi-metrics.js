// pages/api/airroi-metrics.js
export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing listing id" });

    const response = await fetch(
      `https://api.airroi.com/listings/metrics/all?id=${id}&currency=native&num_months=12`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.AIRROI_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
}
