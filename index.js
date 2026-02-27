const { PDFParse } = require("pdf-parse");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

const sampleBarcodes = [
  // Add sample barcodes here
// "2601306315",
// "2601306309",
// "2601306280",
// "2601306271",
// "2601306269",
// "2601306254",
// "2601306244",
// "2601306240",
// "2601306235",
// "2601306202",
// "2601306178",
// "2601306173",
// "2601306165",
// "2601306145",
// "2601306140",
// "2602116385",
// "2602106824",
// "2602106819",
// "2602066541",
// "2602066513",
// "2602056125",
// "2602046593",
"2602046091",
"2602036711",
"2602026248",
"2602016113",
"2602016107",
"2602016097",
"2602016091",
];

// Your custom prompt sent to Claude along with extracted PDF text
const userPrompt = `As a doctor, help to brainstorm with me, how to walkthrough with patient with this lab report focusing *ONLY* on Gut Zoomer part.

For example, what questions you want to ask to follow up to clarify things. What action plan you can suggest patient to follow to mitigate certain concerns
Often report contains section of Questionnaire Data, this is not the report itself, but from patient's responses.
In there, you can further narrow down your question with patient answers
Give a suggested narrative to patient at top level summary, one paragraph. It needs to be in plain English that patient without medical background can easily understand.
And also a patient facing summary document

Action plan needs to cover items fits into below categories in terms of urgency
Immediate
within 2-4 weeks
3-4 month follow up`;

const jwtToken = process.env.JWT_TOKEN || process.env.VIBRANT_JWT_TOKEN;

if (!jwtToken) {
  console.error("Missing JWT token. Add JWT_TOKEN to your .env file.");
  process.exit(1);
}

async function fetchPdfBuffer(sampleBarcode) {
  const url = `https://www.vibrant-america.com/lisapi/v1/lis/base-report-service/pdf-cache/download/${encodeURIComponent(
    sampleBarcode
  )}?style=advanced&mode=download&timezone=America/Los_Angeles`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwtToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Failed to download PDF for ${sampleBarcode}: ${response.status} ${response.statusText}${
        errorText ? ` - ${errorText}` : ""
      }`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function extractTextFromPdf(dataBuffer) {
  const parser = new PDFParse(dataBuffer);
  await parser.load();
  const result = await parser.getText();
  parser.destroy();
  return result;
}

async function runClaudeOnExtractedText(sampleBarcode, extractedText, customPrompt) {
  // if (!process.env.ANTHROPIC_API_KEY) {
  //   throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  // }

  // Dynamic import so this file can stay CommonJS
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const prompt = [
    `Sample barcode: ${sampleBarcode}`,
    "",
    `User instruction: ${customPrompt}`,
    "",
    "Extracted PDF text:",
    extractedText,
  ].join("\n");

  let finalResult = "";

  for await (const message of query({
    prompt,
    options: {
      // No filesystem tools needed for this task; pure text reasoning
      // allowedTools: [],
      permissionMode: "bypassPermissions",
    },
  })) {
    if (message && typeof message === "object" && "result" in message) {
      finalResult = message.result || "";
    }
  }

  return finalResult;
}

async function getUniqueOutputPath(outputDir, baseName) {
  let attempt = 0;

  while (true) {
    const fileName = attempt === 0 ? `${baseName}.md` : `${baseName}_${attempt}.md`;
    const candidatePath = path.join(outputDir, fileName);

    try {
      await fs.access(candidatePath);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
}

async function writeMarkdownOutput(sampleBarcode, llmOutput) {
  const outputDir = path.join(__dirname, "outputs");
  await fs.mkdir(outputDir, { recursive: true });

  const safeBarcode = String(sampleBarcode).replace(/[^a-zA-Z0-9_-]/g, "_");
  const outputPath = await getUniqueOutputPath(outputDir, safeBarcode);
  const content = llmOutput && llmOutput.trim() ? llmOutput : "(No output returned)";

  await fs.writeFile(outputPath, content, "utf8");
  return outputPath;
}

async function main() {
  for (const sampleBarcode of sampleBarcodes) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Processing sample barcode: ${sampleBarcode}`);

    try {
      const pdfBuffer = await fetchPdfBuffer(sampleBarcode);
      console.log(
        `Downloaded PDF size: ${pdfBuffer.length} bytes (${(pdfBuffer.length / 1024).toFixed(2)} KB)`
      );

      const result = await extractTextFromPdf(pdfBuffer);
      console.log(`Total pages: ${result.total}`);
      console.log(`Extracted text size: ${Buffer.byteLength(result.text, "utf8")} bytes`);
      console.log(`Extracted text length: ${result.text.length} characters`);

      const llmOutput = await runClaudeOnExtractedText(sampleBarcode, result.text, userPrompt);
      const outputPath = await writeMarkdownOutput(sampleBarcode, llmOutput);

      console.log("-".repeat(80));
      console.log(`Saved Claude output to: ${outputPath}`);
      console.log("Claude output:");
      console.log(llmOutput || "(No output returned)");
    } catch (error) {
      console.error(`Error processing ${sampleBarcode}:`, error.message || error);
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
