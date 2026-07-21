const { OpenAI } = require('openai');
require('dotenv').config();

// Configure the OpenAI SDK to point to NVIDIA NIM
const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

async function parseDriveData(text, base64Image) {
  try {
    const systemMessage = {
      role: 'system',
      content: 'You are an assistant that extracts structured data from campus placement drives and hiring messages. Extract the details and output strictly a JSON object with the following keys: company, role, ctc, eligibility, deadline, and applyLink. If a detail is missing, set its value to null. Output only the JSON object without any markdown formatting, backticks, or additional text.'
    };

    let userContent = [
      { type: 'text', text: `Here is the message containing the drive info:\n\n${text}` }
    ];

    if (base64Image) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
      });
    }

    const messages = [
      systemMessage,
      { role: 'user', content: userContent }
    ];

    const response = await openai.chat.completions.create({
      model: 'meta/llama-3.2-90b-vision-instruct',
      messages: messages,
      temperature: 0.2,
      max_tokens: 1024,
    });

    const outputText = response.choices[0].message.content.trim();

    // Parse the expected JSON
    try {
      const jsonData = JSON.parse(outputText);
      return jsonData;
    } catch (parseError) {
      console.error('Error parsing JSON from LLM response:', parseError);
      console.log('Raw output:', outputText);
      return null;
    }

  } catch (error) {
    console.error('Error during LLM API call:', error);
    return null;
  }
}

module.exports = { parseDriveData };
