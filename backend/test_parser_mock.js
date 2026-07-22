const proxyquire = require('proxyquire');

class MockOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async () => {
          return {
            choices: [
              {
                message: {
                  content: `{"company": "MockCorp Inc.", "role": "Software Engineer", "ctc": "12 LPA", "eligibility": "B.Tech CSE/IT with 7 CGPA and above", "deadline": "15th Aug 2024", "applyLink": "https://example.com/apply"}`
                }
              }
            ]
          };
        }
      }
    }
  }
}

const { parseDriveData } = proxyquire('./parser', {
  'openai': { OpenAI: MockOpenAI }
});

async function runTest() {
  console.log('Testing parser with mock message...');
  const testMessage = `Campus Drive:
Company: MockCorp Inc.
Role: Software Engineer
CTC: 12 LPA
Eligibility: B.Tech CSE/IT with 7 CGPA and above
Deadline: 15th Aug 2024
Link: https://example.com/apply`;

  const data = await parseDriveData(testMessage, null);
  console.log('Parsed Data:', data);
}

runTest();
