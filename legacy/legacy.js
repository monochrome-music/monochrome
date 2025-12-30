// jQuery 1.12.4 Legacy Support
$(document).ready(function () {
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
  var audioPlayer = $("#audio-player")[0];
  var currentTrackInfo = $("#now-playing-info");

  // Initial Load
  fetchInstances(function (url) {
    currentApiUrl = url;
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
  window.playTrack = function (id) {
    apiRequest(
      "/track/?id=" + id + "&quality=HIGH",
      function (data) {
        if (data && data.data && data.data.manifest) {
          try {
            var manifestStr = base64Decode(data.data.manifest);
            var manifest = JSON.parse(manifestStr);
            if (manifest.urls && manifest.urls.length > 0) {
              var streamUrl = manifest.urls[0];
              // Check if HTML5 audio is supported and has play method
              if (audioPlayer && typeof audioPlayer.play === 'function') {
                audioPlayer.src = streamUrl;
                audioPlayer.play();
              } else {
                playWithEmbed(streamUrl);
              }

              if (currentTrackInfo.length) {
                currentTrackInfo.html("Now Playing...");
              }
            } else {
              alert("No stream URLs found.");
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
      url: "instances.json",
      dataType: "json",
      success: function (instances) {
        if (instances && instances.length > 0) {
          var randomUrl =
            instances[Math.floor(Math.random() * instances.length)];
          if (randomUrl.charAt(randomUrl.length - 1) === "/") {
            randomUrl = randomUrl.substring(0, randomUrl.length - 1);
          }
          callback(randomUrl);
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
    var randomUrl =
      FALLBACK_INSTANCES[Math.floor(Math.random() * FALLBACK_INSTANCES.length)];
    callback(randomUrl);
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
    var finalUrl = currentApiUrl;
    if (isHttpFallback && finalUrl.indexOf("https://") === 0) {
      finalUrl = "http://" + finalUrl.substring(8);
    }

    $.ajax({
      url: finalUrl + endpoint,
      method: "GET",
      dataType: "json",
      success: function (data) {
        success(data);
      },
      error: function (xhr, status, err) {
        if (!isHttpFallback) {
          isHttpFallback = true;
          // Retry with fallback logic (recursive call will pick up isHttpFallback)
          apiRequest(endpoint, success, error);
        } else {
           error("Request Failed: " + status);
        }
      }
    });
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
