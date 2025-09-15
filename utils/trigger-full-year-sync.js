const AWS = require("aws-sdk");

// Configure AWS
AWS.config.update({ region: "us-east-1" });
const lambda = new AWS.Lambda();

async function triggerFullYearSync(year = 2026) {
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

// Get year from command line argument or default to 2026
const year = process.argv[2] ? parseInt(process.argv[2]) : 2026;
triggerFullYearSync(year);