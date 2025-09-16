const AWS = require("aws-sdk");

// Configure AWS
AWS.config.update({ region: "us-east-1" });
const lambda = new AWS.Lambda();

async function triggerFullSeasonSync() {
  console.log("🚀 Triggering full season sync for 2026...");

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
      "\n📊 The sync should fetch all events from June 28 to August 29, 2026",
    );
    console.log("This includes all 9 weeks of the Chautauqua season");
  } catch (error) {
    console.error("❌ Error triggering sync:", error.message);
  }
}

triggerFullSeasonSync();
