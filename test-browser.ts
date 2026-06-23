import { spawn } from "child_process";

const run = async () => {
  console.log("Installing puppeteer...");
  const child = spawn("npm", ["install", "puppeteer", "--no-save"]);
  
  child.stdout.on("data", (data) => console.log(data.toString()));
  child.stderr.on("data", (data) => console.error(data.toString()));
  
  await new Promise((resolve) => child.on("close", resolve));
  console.log("Puppeteer installation complete");
};

run();
