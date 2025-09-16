const AWS = require("aws-sdk");

// Configure AWS
AWS.config.update({ region: "us-east-1" });
const lambda = new AWS.Lambda();

// Default to current year + 1 for upcoming season, or set via environment
const DEFAULT_YEAR = parseInt(process.env.ACTIVE_YEAR || (new Date().getFullYear() + 1));

async function triggerFullYearSync(year = DEFAULT_YEAR) {
  console.log(`🚀 Triggering full year sync for ${year}...`);

  const params = {
    FunctionName: "chq-calendar-data-sync",
    InvocationType: "RequestResponse",
    Payload: JSON.stringify({
      source: "aws.events",
      "detail-type": "Weekly Full Sync",
      time: new Date().toISOString(),
    }),
  };

  try {
    const result = await lambda.invoke(params).promise();
    console.log("✅ Sync triggered successfully");
    console.log("Status Code:", result.StatusCode);

    if (result.Payload) {
      const payload = JSON.parse(result.Payload);
      console.log("Response:", JSON.stringify(payload, null, 2));
    }

    console.log(
      `\n📊 The sync should fetch all events for the entire year ${year}`,
    );
    console.log(`This includes events from January 1, ${year} to December 31, ${year}`);
    console.log("This covers both in-season and off-season events");
  } catch (error) {
    console.error("❌ Error triggering sync:", error.message);
  }
}

// Get year from command line argument or use default
const year = process.argv[2] ? parseInt(process.argv[2]) : DEFAULT_YEAR;
triggerFullYearSync(year);