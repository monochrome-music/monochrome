// strictly ES5/Legacy JS
(function () {
  var currentApiUrl = ""; // Will be set from instances.json
  var isHttpFallback = false;
  var FALLBACK_INSTANCES = [
    "https://triton.squid.wtf",
    "https://wolf.qqdl.site",
    "https://maus.qqdl.site",
    "https://vogel.qqdl.site",
    "https://katze.qqdl.site",
    "https://hund.qqdl.site",
    "https://tidal.kinoplus.online",
    "https://tidal-api.binimum.org",
  ];
  var audioPlayer;
  var currentTrackInfo;

  window.onload = function () {
    audioPlayer = document.getElementById("audio-player");
    currentTrackInfo = document.getElementById("now-playing-info");

    fetchInstances(function (url) {
      currentApiUrl = url;
      loadRecentTracks();
    });

    // Simple event delegation if we wanted, but explicit bindings are safer for old browsers
    var btnHome = document.getElementById("btn-home");
    if (btnHome) {
      btnHome.onclick = function () {
        loadRecentTracks();
        return false;
      };
    }
    // Search button removed, using persistent form now

    var searchForm = document.getElementById("search-form");
    searchForm.onsubmit = function () {
      var query = document.getElementById("search-input").value;
      performSearch(query);
      return false;
    };
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
    var xhr = createXHR();
    xhr.open("GET", "instances.json", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var instances = JSON.parse(xhr.responseText);
            if (instances && instances.length > 0) {
              var randomUrl =
                instances[Math.floor(Math.random() * instances.length)];
              // Remove trailing slash if present
              if (randomUrl.charAt(randomUrl.length - 1) === "/") {
                randomUrl = randomUrl.substring(0, randomUrl.length - 1);
              }
              callback(randomUrl);
            } else {
              useFallback(callback);
            }
          } catch (e) {
            useFallback(callback);
          }
        } else {
          useFallback(callback);
        }
      }
    };
    xhr.onerror = function () {
      useFallback(callback);
    };
    xhr.send();
  }

  function useFallback(callback) {
    var randomUrl =
      FALLBACK_INSTANCES[Math.floor(Math.random() * FALLBACK_INSTANCES.length)];
    callback(randomUrl);
  }

  function performSearch(query) {
    var resultsDiv = document.getElementById("search-results");
    if (!resultsDiv) {
      setContent('<div id="search-results">Searching...</div>');
      resultsDiv = document.getElementById("search-results");
    } else {
      resultsDiv.innerHTML = "Searching...";
    }

    apiRequest(
      "/search/?s=" + encodeURIComponent(query) + "&limit=25",
      function (data) {
        var tracks = (data && data.data && data.data.items) ? data.data.items : [];
        if (tracks.length === 0) {
          resultsDiv.innerHTML = "No results found.";
          return;
        }
        // Manually render table string to avoid complex DOM manipulation
        var html =
          '<table width="100%" border="1" cellpadding="2" cellspacing="0">';
        html +=
          '<tr bgcolor="#bbbbbb"><th>Play</th><th>Title</th><th>Artist</th><th>Album</th></tr>';

        for (var i = 0; i < tracks.length; i++) {
          var t = tracks[i];
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
        }
        html += "</table>";

        resultsDiv.innerHTML = html;
      },
      function (err) {
        resultsDiv.innerHTML = "Error: " + err;
      }
    );
  }

  function renderTracks(tracks, title) {
    var html = "<h3>" + title + "</h3>";
    html += '<table width="100%" border="1" cellpadding="2" cellspacing="0">';
    html +=
      '<tr bgcolor="#bbbbbb"><th>Play</th><th>Title</th><th>Artist</th><th>Album</th></tr>';

    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
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
    }
    html += "</table>";

    setContent(html);
  }

  // Global player function
  window.playTrack = function (id) {
    apiRequest(
      "/track/?id=" + id + "&quality=HIGH",
      function (data) {
         if (data && data.data && data.data.manifest) {
            try {
                // Manifest is Base64 encoded JSON
                var manifestStr = base64Decode(data.data.manifest);
                var manifest = JSON.parse(manifestStr);
                if (manifest.urls && manifest.urls.length > 0) {
                    var streamUrl = manifest.urls[0];
                    if (audioPlayer.play) {
                        audioPlayer.src = streamUrl;
                        audioPlayer.play();
                    } else {
                        // Fallback for IE/Older browsers
                        playWithEmbed(streamUrl);
                    }
                    
                    if (currentTrackInfo) {
                       // We don't get full track info in playback response easily without another call or passing it, 
                       // but for legacy we might accept just "Now Playing..." or maybe we pass it? 
                       // For now simplicity:
                       currentTrackInfo.innerHTML = "Now Playing...";
                    }
                } else {
                    alert("No stream URLs found in manifest.");
                }
            } catch (e) {
                alert("Error parsing playback manifest: " + e.message);
            }
         } else {
            alert("Invalid track data received.");
         }
      },
      function (err) {
        alert("Error playing track: " + err);
      }
    );
  };

  function setContent(html) {
    var content = document.getElementById("main-content");
    content.innerHTML = html;
  }

  function apiRequest(endpoint, success, error) {
    var xhr = createXHR();
    // Use fallback HTTP if needed logic
    var finalUrl = currentApiUrl;
    if (isHttpFallback && finalUrl.indexOf("https://") === 0) {
        finalUrl = "http://" + finalUrl.substring(8);
    }
    
    xhr.open("GET", finalUrl + endpoint, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            success(data);
          } catch (e) {
            error("JSON Parse Error");
          }
        } else {
            // If failed and not yet fallback, try fallback
            if(!isHttpFallback) {
                isHttpFallback = true;
                apiRequest(endpoint, success, error);
            } else {
                 error("HTTP " + xhr.status);
            }
        }
      }
    };
    xhr.onerror = function () {
       if(!isHttpFallback) {
           isHttpFallback = true;
           apiRequest(endpoint, success, error);
       } else {
          error("Network Error");
       }
    };
    xhr.send();
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createXHR() {
      if (window.XMLHttpRequest) {
          return new XMLHttpRequest();
      }
      // IE5/6 support
      try {
          return new ActiveXObject("Msxml2.XMLHTTP");
      } catch (e) {}
      try {
          return new ActiveXObject("Microsoft.XMLHTTP");
      } catch (e) {}
      alert("Your browser does not support AJAX!");
      return null;
  }

  function base64Decode(str) {
      if (window.atob) {
          return window.atob(str);
      }
      // Polyfill for IE
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

  function playWithEmbed(url) {
      var container = document.getElementById("audio-container");
      if (!container) {
          // If no container, try to find parent of audio player
          if (audioPlayer && audioPlayer.parentNode) {
              container = audioPlayer.parentNode;
              // Give it an ID for future reference
              container.id = "audio-container";
          }
      }
      
      if (container) {
          // Clear previous embeds
          // Removing innerHTML is the brute force way but effective for legacy
          // However, we want to keep the text status if it's in there (it's not, status is sibling in .controls)
          // The audio player is in .controls. 
          
          // Let's create a specific div for embed if it doesn't exist, appended to container
          var embedDiv = document.getElementById("embed-container");
          if (!embedDiv) {
              embedDiv = document.createElement("div");
              embedDiv.id = "embed-container";
              container.appendChild(embedDiv);
          }
          
          var html = '<embed type="application/x-mplayer2" src="' + url + '" autostart="true" width="0" height="0" enablejavascript="true"></embed>';
          embedDiv.innerHTML = html;
      }
  }
})();
