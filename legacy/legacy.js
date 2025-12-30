// jQuery 1.12.4 Legacy Support
$(document).ready(function () {
  var apiInstances = [];
  var currentInstanceIndex = 0;
  var isHttpFallback = false;
  var FALLBACK_INSTANCES = [
    "https://wolf.qqdl.site",
    "https://maus.qqdl.site",
    "https://vogel.qqdl.site",
    "https://katze.qqdl.site",
    "https://hund.qqdl.site",
    "https://tidal.kinoplus.online",
    "https://tidal-api.binimum.org",
  ];
  var audioPlayer = $("#audio-player")[0];
  var currentTrackInfo = $("#now-playing-info");

  // Initialize SoundJS
  // Note: Class is FlashPlugin in 0.5.2, but SWF is FlashAudioPlugin.swf
  createjs.FlashPlugin.swfPath = "./"; 
  // Prioritize HTMLAudio -> WebAudio -> Flash
  // HTMLAudio is better for streaming music (avoids XHR/CORS issues of WebAudio)
  createjs.Sound.registerPlugins([createjs.HTMLAudioPlugin, createjs.WebAudioPlugin, createjs.FlashPlugin]);
  
  // Initial Load
  fetchInstances(function () {
    loadRecentTracks();
  });

  // Event Bindings
  $("#btn-home").click(function (e) {
    e.preventDefault();
    loadRecentTracks();
  });

  $("#search-form").submit(function (e) {
    e.preventDefault();
    var query = $("#search-input").val();
    performSearch(query);
  });

  // Global functions exposed for inline onclicks
  // Global functions exposed for inline onclicks
  // Global Stop function to prevent overlap
  function stopAllAudio() {
      // 1. Stop SoundJS
      if (typeof createjs !== "undefined" && createjs.Sound) {
          createjs.Sound.stop();
      }
      
      // 2. Stop DOM Player
      if (audioPlayer) {
          try {
              audioPlayer.pause();
              audioPlayer.currentTime = 0;
              // Don't clear src immediately as it might flash, just pause.
          } catch(e) { }
      }
  }

  window.playTrack = function (id, attemptFallback) {
    var quality = attemptFallback ? "HIGH" : "LOSSLESS";
    apiRequest(
      "/track/?id=" + id + "&quality=" + quality,
      function (data) {
        if (data && data.data && data.data.manifest) {
          try {
            var manifestStr = base64Decode(data.data.manifest);
            var manifest = JSON.parse(manifestStr);
            if (manifest.urls && manifest.urls.length > 0) {
              var streamUrl = manifest.urls[0];
              
              // Unified Playback Strategy:
              // 1. Stop Everything
              stopAllAudio();
              
              // 2. Try Native DOM Player (Visible Interface)
              // If this works, user gets controls. If it fails (IE), we fallback to SoundJS.
              playNativeFirst(streamUrl, id, quality);
            }
          } catch (e) {
             console.log("Manifest error: " + e);
          }
        } else {
             handleError("Invalid track data");
        }
      },
      function (err) {
        handleError(err);
      }
    );
    
    function playNativeFirst(url, id, quality) {
        var domPlayer = $("#audio-player")[0];
        
        // Quality Label
        var qLabel = (quality === "LOSSLESS") ? " (FLAC)" : " (AAC)";
        if (attemptFallback) qLabel = " (AAC)";
        
        // Basic check for audio support
        if (domPlayer && typeof domPlayer.play === 'function') {
            
            // Explicitly check for Codec support
            if (quality === "LOSSLESS") {
                // FLAC check
                var canPlay = "";
                try {
                    canPlay = domPlayer.canPlayType("audio/flac");
                } catch(e) {}
                
                if (canPlay === "" || canPlay === "no") {
                     console.log("Browser reports no FLAC support. Fallback to AAC.");
                     // Directly fallback to AAC
                     if (!attemptFallback) {
                         window.playTrack(id, true);
                         return;
                     }
                }
            }

            updateStatus("Starting Native Playback" + qLabel + "...");
            
            // Set error handler for THIS attempt
            domPlayer.onerror = function() {
                var errCode = domPlayer.error ? domPlayer.error.code : 0;
                console.log("Native Error Code: " + errCode);
                // Fallback to legacy
                playLegacySoundJS(url, id, quality);
            };
            
            try {
                domPlayer.src = url;
                var playPromise = domPlayer.play();
                
                if (playPromise !== undefined) {
                    playPromise
                        .then(function() {
                            updateStatus("Now Playing..." + qLabel);
                        })
                        .catch(function(e) {
                            console.log("Native Play Promise Rejected: " + e.name);
                            // Auto-play policy or format issue? 
                            // Try SoundJS as fallback
                            playLegacySoundJS(url, id, quality);
                        });
                } else {
                    // Legacy browser (no promise), assume success unless onError fires
                    updateStatus("Now Playing..." + qLabel);
                }
            } catch (e) {
                console.log("Native Exception: " + e.message);
                playLegacySoundJS(url, id, quality);
            }
            
        } else {
            // No native audio support (IE < 9)
            playLegacySoundJS(url, id, quality);
        }
    }
    
    function playLegacySoundJS(url, id, quality) {
        updateStatus("Activating Legacy Player (Flash)...");
        
        // SoundJS Logic
        var soundJsUrl = url;
        // Hint extension for SoundJS
        if (soundJsUrl.indexOf(".mp3") === -1 && soundJsUrl.indexOf(".m4a") === -1) {
             soundJsUrl += "#.m4a"; // Default to AAC hint
        }
        
        // If FLAC and we are here, SoundJS will likely fail, but we'll try or alert.
        if (quality === "LOSSLESS") {
            // SoundJS can't do FLAC. And if native failed, we are out of luck for FLAC.
            // Try falling back to AAC quality for the whole track?
            if (!attemptFallback) {
                console.log("FLAC failed native, switching to HIGH quality fallback...");
                window.playTrack(id, true);
                return;
            }
        }

        var soundId = "track_" + id + "_" + quality;
        createjs.Sound.removeAllEventListeners("fileload");
        
        var playSound = function() {
             var instance = createjs.Sound.play(soundId);
             if (!instance || instance.playState === createjs.Sound.PLAY_FAILED) {
                 handleError("Legacy Playback Failed");
             } else {
                 updateStatus("Now Playing via Flash/Legacy...");
             }
        };

        createjs.Sound.addEventListener("fileload", function(event) {
            if (event.id === soundId) {
                playSound();
            }
        });

        try {
            createjs.Sound.registerSound(soundJsUrl, soundId);
        } catch(e) {
            handleError("Legacy Setup Failed: " + e.message);
        }
    }

    function updateStatus(msg) {
         if (currentTrackInfo.length) {
            currentTrackInfo.html(msg);
         }
    }

    function handleError(msg) {
        if (!attemptFallback) {
             window.playTrack(id, true);
        } else {
             // alert("Playback Error: " + (msg || "Unknown"));
             updateStatus("Error: " + msg);
        }
    }
  };

  function loadRecentTracks() {
    setContent("Loading recent tracks...");
    apiRequest(
      "/search/?s=a&limit=20",
      function (data) {
        if (data && data.data && data.data.items) {
          renderTracks(data.data.items, "Recently Added / Popular");
        } else {
          setContent("No recent tracks found.");
        }
      },
      function (err) {
        setContent("Error loading tracks: " + err);
      }
    );
  }

  function fetchInstances(callback) {
    // using $.ajax directly to handle errors robustly
    $.ajax({
      url: "/instances.json",
      dataType: "json",
      success: function (instances) {
        if (instances && instances.length > 0) {
          apiInstances = shuffleArray(instances);
          // Clean URLs
          for (var i = 0; i < apiInstances.length; i++) {
              if (apiInstances[i].charAt(apiInstances[i].length - 1) === "/") {
                 apiInstances[i] = apiInstances[i].substring(0, apiInstances[i].length - 1);
              }
          }
          currentInstanceIndex = 0;
          callback();
        } else {
          useFallback(callback);
        }
      },
      error: function () {
        useFallback(callback);
      }
    });
  }

  function useFallback(callback) {
    apiInstances = shuffleArray(FALLBACK_INSTANCES.slice()); // Copy and shuffle
    currentInstanceIndex = 0;
    callback();
  }

  function shuffleArray(array) {
      for (var i = array.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var temp = array[i];
          array[i] = array[j];
          array[j] = temp;
      }
      return array;
  }

  function performSearch(query) {
    var resultsDiv = $("#search-results");
    if (resultsDiv.length === 0) {
      setContent('<div id="search-results">Searching...</div>');
      resultsDiv = $("#search-results");
    } else {
      resultsDiv.html("Searching...");
    }

    apiRequest(
      "/search/?s=" + encodeURIComponent(query) + "&limit=25",
      function (data) {
        var tracks = (data && data.data && data.data.items) ? data.data.items : [];
        if (tracks.length === 0) {
          resultsDiv.html("No results found.");
          return;
        }

        var html =
          '<table width="100%" border="1" cellpadding="2" cellspacing="0">';
        html +=
          '<tr bgcolor="#bbbbbb"><th>Play</th><th>Title</th><th>Artist</th><th>Album</th></tr>';

        $.each(tracks, function (i, t) {
          var safeTitle = escapeHtml(t.title);
          var safeArtist = escapeHtml(t.artist.name);
          var safeAlbum = escapeHtml(t.album.title);

          html += '<tr class="track-row">';
          html +=
            '<td align="center"><button onclick="window.playTrack(\'' +
            t.id +
            "')\">Play</button></td>";
          html += "<td>" + safeTitle + "</td>";
          html += "<td>" + safeArtist + "</td>";
          html += "<td>" + safeAlbum + "</td>";
          html += "</tr>";
        });
        html += "</table>";

        resultsDiv.html(html);
      },
      function (err) {
        resultsDiv.html("Error: " + err);
      }
    );
  }

  function renderTracks(tracks, title) {
    var html = "<h3>" + title + "</h3>";
    html += '<table width="100%" border="1" cellpadding="2" cellspacing="0">';
    html +=
      '<tr bgcolor="#bbbbbb"><th>Play</th><th>Title</th><th>Artist</th><th>Album</th></tr>';

    $.each(tracks, function (i, t) {
      var safeTitle = escapeHtml(t.title);
      var safeArtist = escapeHtml(t.artist.name);
      var safeAlbum = escapeHtml(t.album.title);

      html += '<tr class="track-row">';
      html +=
        '<td align="center"><button onclick="window.playTrack(\'' +
        t.id +
        "')\">Play</button></td>";
      html += "<td>" + safeTitle + "</td>";
      html += "<td>" + safeArtist + "</td>";
      html += "<td>" + safeAlbum + "</td>";
      html += "</tr>";
    });
    html += "</table>";

    setContent(html);
  }

  function setContent(html) {
    $("#main-content").html(html);
  }

  function apiRequest(endpoint, success, error) {
    if (apiInstances.length === 0) {
        error("No API instances available.");
        return;
    }

    var currentBaseUrl = apiInstances[currentInstanceIndex];
    var finalUrl = currentBaseUrl;
    
    // Check for HTTP fallback
    if (isHttpFallback) {
       // If original was https, downgrade it
       if (finalUrl.indexOf("https://") === 0) {
           finalUrl = "http://" + finalUrl.substring(8);
       }
    }

    try {
        $.ajax({
          url: finalUrl + endpoint,
          method: "GET",
          dataType: "json",
          success: function (data) {
            // Logic: If successful with HTTP fallback, maybe we should stick to it?
            // For now, we just proceed.
            success(data);
          },
          error: function (xhr, status, errorThrown) {
            handleApiError(endpoint, success, error, status + " (" + errorThrown + ")");
          }
        });
    } catch (e) {
        handleApiError(endpoint, success, error, "Exception: " + e.message);
    }
  }

  function handleApiError(endpoint, success, error, errorMsg) {
      // 1. Try HTTP fallback for current instance if allowed
      if (!isHttpFallback && window.location.protocol !== "https:") {
          // Only if current instance is HTTPS
          if (apiInstances[currentInstanceIndex].indexOf("https://") === 0) {
              isHttpFallback = true;
              apiRequest(endpoint, success, error);
              return;
          }
      }

      // 2. Move to next instance
      isHttpFallback = false; // Reset for next instance
      currentInstanceIndex++;
      
      if (currentInstanceIndex < apiInstances.length) {
          // Retry with next instance
          apiRequest(endpoint, success, error);
      } else {
          // All instances failed
          // We could try to reset index and wait, but for now we fail.
          // Or maybe we should loop back to 0? But infinite loops are bad.
          // Let's just fail after one full rotation.
          currentInstanceIndex = 0; // Reset for next user interaction attempt
          error("All API instances failed. Last error: " + errorMsg);
      }
  }

  function playWithEmbed(url) {
    var container = $("#audio-container");
    if (container.length === 0) {
        if (audioPlayer && audioPlayer.parentNode) {
            $(audioPlayer.parentNode).attr("id", "audio-container");
            container = $("#audio-container");
        }
    }
    
    if (container.length) {
        var embedDiv = $("#embed-container");
        if (embedDiv.length === 0) {
           embedDiv = $('<div id="embed-container"></div>');
           container.append(embedDiv);
        }
        // Use html() to set innerHTML properly
        var embedHtml = '<embed type="application/x-mplayer2" src="' + url + '" autostart="true" width="0" height="0" enablejavascript="true"></embed>';
        embedDiv.html(embedHtml);
    }
  }

  // Helpers
  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function base64Decode(str) {
    if (window.atob) {
      return window.atob(str);
    }
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var output = "";
    str = String(str).replace(/=+$/, '');
    if (str.length % 4 == 1) {
      throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
    }
    for (
      var bc = 0, bs = 0, buffer, i = 0;
      buffer = str.charAt(i++);
      ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
        bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
    ) {
      buffer = chars.indexOf(buffer);
    }
    return output;
  }
});
