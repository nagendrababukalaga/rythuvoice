// RythuVoice – Frontend Audio Recording (WAV) & Backend Integration
// Records microphone audio directly as a clean WAV (PCM 16-bit) file using Web Audio API
// and sends it to FastAPI backend (/upload-audio) for Gnani Prisma STT & FAQ matching.

// --- Step 1: HTML Element references ---
var micButton       = document.getElementById("mic-btn");
var questionDisplay = document.getElementById("question-display");
var answerDisplay   = document.getElementById("answer-display");
var audioUpload     = document.getElementById("audio-upload");

// Backend endpoint URL
var BACKEND_URL = "https://rythuvoice.onrender.com/upload-audio";
// --- Step 2: Audio Recording State Variables ---
var audioContext    = null;
var mediaStream     = null;
var scriptProcessor = null;
var audioBuffers    = [];
var totalSampleCount = 0;
var isRecording     = false;


// --- Step 3: Helper function to convert raw PCM to standard WAV Blob ---
function encodeWAV(samples, sampleRate) {
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);

  function writeString(offset, string) {
    for (var i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF identifier
  writeString(0, "RIFF");
  // File length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(8, "WAVE");
  // Format chunk identifier
  writeString(12, "fmt ");
  // Format chunk length (16 for PCM)
  view.setUint32(16, 16, true);
  // Sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // Channel count (1 = Mono)
  view.setUint16(22, 1, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate (SampleRate * 1 channel * 2 bytes)
  view.setUint32(28, sampleRate * 2, true);
  // Block align (1 channel * 2 bytes)
  view.setUint16(32, 2, true);
  // Bits per sample (16-bit)
  view.setUint16(34, 16, true);
  // Data chunk identifier
  writeString(36, "data");
  // Data chunk length
  view.setUint32(40, samples.length * 2, true);

  // Write 16-bit PCM samples
  var offset = 44;
  for (var i = 0; i < samples.length; i++, offset += 2) {
    var s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: "audio/wav" });
}


// --- Step 4: Send Audio to FastAPI Backend ---
function sendAudioToBackend(audioBlob, fileName) {
  // Show loading state
  questionDisplay.textContent = "⏳ ఆడియో విశ్లేషిస్తున్నాము... (Processing your audio...)";
  answerDisplay.textContent   = "⏳ సమాధానం కోసం వేచి ఉండండి... (Getting crop answer from server...)";

  var formData = new FormData();
  formData.append("file", audioBlob, fileName);

  fetch(BACKEND_URL, {
    method: "POST",
    body: formData
  })
  .then(function (response) {
    if (!response.ok) {
      return response.json().then(function (errData) {
        throw new Error(errData.detail || ("Server error: " + response.status));
      }).catch(function () {
        throw new Error("Server returned status " + response.status);
      });
    }
    return response.json();
  })
  .then(function (data) {
    if (data.success) {
      // Display Telugu transcript
      if (data.transcript && data.transcript.trim() !== "") {
        questionDisplay.textContent = data.transcript;
      } else {
        questionDisplay.textContent = "⚠️ మాట స్పష్టంగా వినిపించలేదు. దయచేసి మళ్లీ మాట్లాడండి. (Speech could not be recognized clearly. Please try again.)";
      }

      // Display FAQ answer
      if (data.faq_answer) {
        answerDisplay.textContent = data.faq_answer;
      } else {
        answerDisplay.textContent = "మీ ప్రశ్నకు సమాధానం దొరకలేదు. (No answer found.)";
      }
    } else {
      questionDisplay.textContent = "⚠️ ప్రాసెస్ చేయడం విఫలమైంది. (Processing failed.)";
      answerDisplay.textContent   = "సమస్య వచ్చింది. దయచేసి మళ్లీ ప్రయత్నించండి. (An error occurred. Please try again.)";
    }
  })
  .catch(function (error) {
    console.error("Upload error:", error);
    questionDisplay.textContent = "⚠️ సర్వర్‌కు కనెక్ట్ కాలేకపోయాము. (Could not connect to backend server.)";
    answerDisplay.textContent   = "సమస్య: " + error.message;
  });
}


// --- Step 5: Start / Stop Recording with Web Audio API (produces WAV) ---
function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function (stream) {
      mediaStream = stream;
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();

      var inputSource = audioContext.createMediaStreamSource(stream);

      // Buffer size: 4096, 1 input channel (mono), 1 output channel
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioBuffers = [];
      totalSampleCount = 0;

      scriptProcessor.onaudioprocess = function (e) {
        if (!isRecording) return;
        var inputData = e.inputBuffer.getChannelData(0);
        // Clone samples to prevent browser buffer mutation
        var bufferCopy = new Float32Array(inputData);
        audioBuffers.push(bufferCopy);
        totalSampleCount += bufferCopy.length;
      };

      inputSource.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      isRecording = true;
      micButton.textContent = "🔴 ఆపడానికి నొక్కండి (Click to Stop)";
      micButton.style.backgroundColor = "#c62828";
      questionDisplay.textContent = "🔴 రికార్డ్ అవుతున్నది... మాట్లాడండి. (Recording... Speak now. Click to stop.)";
      answerDisplay.textContent = "మీరు మాట్లాడిన తర్వాత సమాధానం వస్తుంది... (Waiting for your question...)";
    })
    .catch(function (error) {
      if (error.name === "NotAllowedError") {
        questionDisplay.textContent = "⚠️ మైక్రోఫోన్ అనుమతి నిరాకరించబడింది. (Microphone permission denied.)";
      } else if (error.name === "NotFoundError") {
        questionDisplay.textContent = "⚠️ మైక్రోఫోన్ కనుగొనబడలేదు. (No microphone found.)";
      } else {
        questionDisplay.textContent = "⚠️ మైక్రోఫోన్ తెరవడం సాధ్యం కాలేదు: " + error.message;
      }
    });
}

function stopRecording() {
  isRecording = false;

  // Disconnect audio nodes
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }

  // Stop mic tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(function (track) {
      track.stop();
    });
    mediaStream = null;
  }

  var sampleRate = audioContext ? audioContext.sampleRate : 44100;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  // Reset button UI
  micButton.textContent = "🎙️ Start Speaking";
  micButton.style.backgroundColor = "";

  // Merge audio buffer chunks
  var mergedSamples = new Float32Array(totalSampleCount);
  var offset = 0;
  for (var i = 0; i < audioBuffers.length; i++) {
    mergedSamples.set(audioBuffers[i], offset);
    offset += audioBuffers[i].length;
  }

  // Convert to valid WAV Blob and send to backend
  var wavBlob = encodeWAV(mergedSamples, sampleRate);
  sendAudioToBackend(wavBlob, "recording.wav");
}


// --- Step 6: Button Click Listener ---
micButton.addEventListener("click", function () {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});


// --- Step 7: Audio File Upload Listener ---
audioUpload.addEventListener("change", function () {
  var file = audioUpload.files[0];
  if (!file) return;

  sendAudioToBackend(file, file.name);
});
