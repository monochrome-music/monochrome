// jQuery 1.12.4 Legacy Support
$(document).ready(function () {
  // CORS Support for IE8/9 (XDomainRequest)
  // Required because IE8/9 do not support CORS via standard XMLHttpRequest
  if (window.XDomainRequest) {
      $.ajaxTransport(function(s) {
          if (s.crossDomain && s.async) {
              if (s.timeout) {
                  s.xdrTimeout = s.timeout;
                  delete s.timeout;
              }
              var xdr;
              return {
                  send: function(_, complete) {
                      function callback(status, statusText, responses, responseHeaders) {
                          xdr.onload = xdr.onerror = xdr.ontimeout = $.noop;
                          xdr = undefined;
                          complete(status, statusText, responses, responseHeaders);
                      }
                      xdr = new XDomainRequest();
                      try {
                          xdr.open(s.type, s.url);
                          xdr.onload = function() {
                              callback(200, "OK", { text: xdr.responseText }, "Content-Type: " + xdr.contentType);
                          };
                          xdr.onerror = function() {
                              callback(404, "Not Found");
                          };
                          xdr.ontimeout = function() {
                              callback(0, "timeout");
                          };
                          xdr.timeout = s.xdrTimeout || Number.MAX_VALUE;
                          xdr.send((s.hasContent && s.data) || null);
                      } catch(e) {
                          // Protocol Mismatch generally throws here in IE
                          callback(500, "Protocol/Access Error", { text: e.message });
                      }
                  },
                  abort: function() {
                      if (xdr) {
                          xdr.onerror = $.noop;
                          xdr.abort();
                      }
                  }
              };
          }
      });
  }
  // REMOVED: $.support.cors = true; 
  // We MUST NOT set this for IE9. If we do, jQuery tries to use standard XHR for cross-domain, 
  // which fails ("Access is denied"). Leaving it false forces jQuery to use our custom XDR transport.

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
  // Custom Architecture:
  // We handle HTML5 Audio manually via playNativeFirst() for full control (UI, timeouts, hacks).
  // SoundJS is reserved STRICTLY for Flash fallback on legacy browsers (IE, old Chrome).
  // Therefore, we ONLY register the FlashPlugin.
  createjs.Sound.registerPlugins([createjs.FlashPlugin]);
  
  // Initial Load
  // Run HTTPS probe first
  checkHttpsSupport(function() {
      fetchInstances(function () {
        loadRecentTracks();
      });
  });

  function checkHttpsSupport(callback) {
      if (window.location.protocol === "http:") {
          // If we are already on HTTP, we might want to check if HTTPS is possible?
          // Or just assume if user loaded via HTTP, we might need HTTP for APIs too.
          // But user might be on HTTP because they typed it, but API supports HTTPS.
          // Let's Probe.
          // However, if we are on HTTPS, mixed content blocking might prevent HTTP fallback checking?
          // Actually, we want to know if Client supports HTTPS.
      }
      
      // Probe a known HTTPS endpoint (one of our instances)
      // Use a known stable one, or just try the first instance later?
      // Better to fail fast now.
      var probeUrl = "https://tidal.kinoplus.online/";
      
      console.log("Probing HTTPS support...");
      
      var probeSuccess = false;
      var probeFinished = false;
      
      function finishProbe(success) {
          if (probeFinished) return;
          probeFinished = true;
          if (success) {
              console.log("HTTPS Probe Successful.");
              isHttpFallback = false;
          } else {
              console.log("HTTPS Probe Failed. Defaulting to HTTP fallback.");
              isHttpFallback = true;
          }
          callback();
      }
      
      var timeout = setTimeout(function() {
          finishProbe(false);
      }, 5000); // 3s timeout for HTTPS check
      
      try {
          $.ajax({
              url: probeUrl,
              dataType: "json",
              timeout: 2500, // jQuery timeout
              success: function() {
                  finishProbe(true);
              },
              error: function() {
                  finishProbe(false); // XHR Error or Timeout
              }
          });
      } catch(e) {
          finishProbe(false);
      }
  }

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
    
    function playNativeFirst(url, id, quality, isRetry) {
        var domPlayer = $("#audio-player")[0];
        var playbackTimer = null;
        
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
                     if (!attemptFallback) {
                         window.playTrack(id, true);
                         return;
                     }
                }
            }

            updateStatus("Starting Native Playback" + qLabel + ((isRetry) ? " (HTTP)..." : "..."));
            
            // Helper to handle retry vs legacy fallback
            function triggerRetryOrLegacy(msg) {
                if (playbackTimer) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
                
                // Try HTTP fallback if SSL failed
                if (!isRetry && url.indexOf("https://") === 0) {
                     console.log("HTTPS failed/timeout (" + msg + "), retrying with HTTP...");
                     var httpUrl = "http://" + url.substring(8);
                     playNativeFirst(httpUrl, id, quality, true);
                     return;
                }
                
                playLegacySoundJS(streamUrl, id, quality);
            }
            
            // Set error handler for THIS attempt
            domPlayer.onerror = function() {
                var errCode = domPlayer.error ? domPlayer.error.code : 0;
                console.log("Native Error Code: " + errCode);
                triggerRetryOrLegacy("onerror: " + errCode);
            };
            
            try {
                domPlayer.src = url;
                domPlayer.preload = "auto";
                domPlayer.load(); // Force reload/buffering
                
                var playPromise = domPlayer.play();
                
                // Set a safety timeout for "forever pending" requests (common in Chrome 15 with SSL issues)
                playbackTimer = setTimeout(function() {
                    console.log("Playback timeout - stalling detected.");
                    triggerRetryOrLegacy("timeout");
                }, 5000); // 5 seconds to start playing
                
                // If playback starts, clear timeout
                domPlayer.onplaying = function() {
                    if (playbackTimer) {
                        clearTimeout(playbackTimer);
                        playbackTimer = null;
                    }
                    updateStatus("Now Playing..." + qLabel);
                };

                if (playPromise !== undefined) {
                    playPromise
                        .then(function() {
                            // Promise resolved doesn't always mean playing started (buffering)
                            // But usually it means intent is accepted.
                            // We keep timer running until 'onplaying' checks in? 
                            // Actually promise resolve just means "accepted". 
                            // Chrome 15 won't have promise.
                            // Modern browsers: resolve -> wait for data -> playing.
                            // If data hangs, promise resolved but playing never fires.
                            // So we keep timer.
                        })
                        .catch(function(e) {
                            console.log("Native Play Promise Rejected: " + e.name);
                            triggerRetryOrLegacy("promise rejection: " + e.name);
                        });
                } else {
                    // Legacy browser (no promise)
                    // Wait for onplaying or timeout
                }
            } catch (e) {
                console.log("Native Exception: " + e.message);
                triggerRetryOrLegacy("exception: " + e.message);
            }
            
        } else {
            // No native audio support (IE < 9)
            playLegacySoundJS(streamUrl, id, quality);
        }
    }
    
    function playLegacySoundJS(url, id, quality, isRetry) {
        updateStatus("Activating Legacy Player (Flash)" + ((isRetry) ? " (HTTP)..." : "..."));
        
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

        var soundId = "track_" + id + "_" + quality + (isRetry ? "_http" : "");
        createjs.Sound.removeAllEventListeners("fileload");
        
        var playSound = function() {
             var instance = createjs.Sound.play(soundId);
             if (!instance || instance.playState === createjs.Sound.PLAY_FAILED) {
                 handleLegacyError("Legacy Playback Failed");
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
            handleLegacyError("Legacy Setup Failed: " + e.message);
        }
        
        function handleLegacyError(msg) {
             if (!isRetry && url.indexOf("https://") === 0) {
                 console.log("Legacy HTTPS failed ("+msg+"), retrying HTTP...");
                 var httpUrl = "http://" + url.substring(8);
                 playLegacySoundJS(httpUrl, id, quality, true);
                 return;
             }
             handleError(msg);
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
