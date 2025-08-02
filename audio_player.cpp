#include <iostream>
#include <gtk/gtk.h>
#include <portaudio.h>
#include <sndfile.h>
#include <vector>
#include <cairo/cairo.h>

static GtkWidget *fileChooserDialog;
static PaStream *audioStream = nullptr;
static SNDFILE *audioFile = nullptr;
static SF_INFO audioFileInfo;

static float leftVolume = 1.0;
static float rightVolume = 1.0;
static std::vector<float> audioData;  // Store audio data for the visualizer

// Variables for the visualizer
static GtkWidget *drawingArea;
static cairo_surface_t *waveformSurface = nullptr;
static int waveformWidth = 800;
static int waveformHeight = 100;

// Wide and spacious soundstage control
static float wideLeftSliderValue = 0.5;       // Initial value for wide left slider
static float wideRightSliderValue = 0.5;      // Initial value for wide right slider

static int audioCallback(const void *inputBuffer, void *outputBuffer,
                        unsigned long frameCount,
                        const PaStreamCallbackTimeInfo *timeInfo,
                        PaStreamCallbackFlags statusFlags,
                        void *userData) {
  if (!audioFile) return paAbort;
  sf_count_t framesRead = sf_readf_float(audioFile, (float *)outputBuffer, frameCount);

  if (framesRead > 0) {
    for (sf_count_t i = 0; i < framesRead; i++) {
      for (int j = 0; j < audioFileInfo.channels; j++) {
        float sample = ((float *)outputBuffer)[i * audioFileInfo.channels + j];

        // Apply volume to each channel
        if (j == 0) {  // Left channel
          ((float *)outputBuffer)[i * audioFileInfo.channels + j] = leftVolume * (1.0 - wideLeftSliderValue) * sample;
        } else if (j == 1) {  // Right channel
          ((float *)outputBuffer)[i * audioFileInfo.channels + j] = rightVolume * (1.0 - wideRightSliderValue) * sample;
        }
      }
    }

    // Store audio data for the visualizer
    audioData.insert(audioData.end(), (float *)outputBuffer, (float *)outputBuffer + framesRead * audioFileInfo.channels);

    // Update the visualizer
    gtk_widget_queue_draw(drawingArea);
  }

  if (framesRead < frameCount) {
    return paComplete;
  }

  return paContinue;
}

static gboolean onDraw(GtkWidget *widget, cairo_t *cr, gpointer data) {
  if (!waveformSurface) {
    waveformSurface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, waveformWidth, waveformHeight);
  }

  cairo_t *waveformContext = cairo_create(waveformSurface);
  cairo_set_source_rgb(waveformContext, 0.0, 0.0, 0.0);  // Background color
  cairo_paint(waveformContext);

  if (!audioData.empty()) {
    cairo_set_source_rgb(waveformContext, 0.0, 1.0, 0.0);  // Waveform color

    cairo_move_to(waveformContext, 0, waveformHeight / 2);

    for (int i = 0; i < waveformWidth; i++) {
      int dataIndex = i * audioData.size() / waveformWidth;
      float value = audioData[dataIndex];
      float y = waveformHeight / 2 - (value * waveformHeight / 2);
      cairo_line_to(waveformContext, i, y);
    }

    cairo_stroke(waveformContext);
  }

  cairo_set_source_surface(cr, waveformSurface, 0, 0);
  cairo_paint(cr);
  cairo_destroy(waveformContext);

  return FALSE;
}

static void openAudioFile(GtkWidget *widget, gpointer data) {
  fileChooserDialog = gtk_file_chooser_dialog_new("Open Audio File", NULL,
                                                 GTK_FILE_CHOOSER_ACTION_OPEN,
                                                 "_Cancel", GTK_RESPONSE_CANCEL,
                                                 "_Open", GTK_RESPONSE_ACCEPT, NULL);

  if (gtk_dialog_run(GTK_DIALOG(fileChooserDialog)) == GTK_RESPONSE_ACCEPT) {
    const gchar *selectedFile = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(fileChooserDialog));

    if (!selectedFile) {
      return;
    }

    if (audioFile) {
      sf_close(audioFile);
      audioFile = nullptr;
    }

    audioFile = sf_open(selectedFile, SFM_READ, &audioFileInfo);
    if (!audioFile) {
      std::cerr << "Error opening audio file." << std::endl;
      return;
    }

    if (audioStream) {
      Pa_StopStream(audioStream);
      Pa_CloseStream(audioStream);
    }

    Pa_OpenDefaultStream(&audioStream, 0, audioFileInfo.channels, paFloat32, audioFileInfo.samplerate, 256, audioCallback, audioFile);
    Pa_StartStream(audioStream);
  }

  gtk_widget_destroy(fileChooserDialog);
}

static void leftVolumeChanged(GtkRange *range, gpointer data) {
  leftVolume = (float)gtk_range_get_value(range);
}

static void rightVolumeChanged(GtkRange *range, gpointer data) {
  rightVolume = (float)gtk_range_get_value(range);
}

static void wideLeftSliderValueChanged(GtkRange *range, gpointer data) {
  wideLeftSliderValue = (float)gtk_range_get_value(range);
}

static void wideRightSliderValueChanged(GtkRange *range, gpointer data) {
  wideRightSliderValue = (float)gtk_range_get_value(range);
}

int main(int argc, char *argv[]) {
  gtk_init(&argc, &argv);

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Audio Mixer");
  gtk_window_set_default_size(GTK_WINDOW(window), 400, 200);
  g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

  GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
  gtk_container_add(GTK_CONTAINER(window), hbox);

  // Create a drawing area for the visualizer
  drawingArea = gtk_drawing_area_new();
  gtk_widget_set_size_request(drawingArea, waveformWidth, waveformHeight);
  g_signal_connect(drawingArea, "draw", G_CALLBACK(onDraw), NULL);
  gtk_box_pack_start(GTK_BOX(hbox), drawingArea, FALSE, FALSE, 0);

  GtkWidget *button = gtk_button_new_with_label("Open Audio File");
  g_signal_connect(button, "clicked", G_CALLBACK(openAudioFile), NULL);
  gtk_box_pack_start(GTK_BOX(hbox), button, FALSE, FALSE, 0);

  GtkWidget *slidersHBox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);

  GtkWidget *leftLabel = gtk_label_new("Left Volume");
  GtkWidget *rightLabel = gtk_label_new("Right Volume");

  GtkWidget *leftVolumeSlider = gtk_scale_new_with_range(GTK_ORIENTATION_VERTICAL, 0.0, 2.0, 0.01);
  GtkWidget *rightVolumeSlider = gtk_scale_new_with_range(GTK_ORIENTATION_VERTICAL, 0.0, 2.0, 0.01);

  gtk_range_set_inverted(GTK_RANGE(leftVolumeSlider), TRUE);
  gtk_range_set_inverted(GTK_RANGE(rightVolumeSlider), TRUE);

  gtk_scale_set_value_pos(GTK_SCALE(leftVolumeSlider), GTK_POS_LEFT);
  gtk_scale_set_value_pos(GTK_SCALE(rightVolumeSlider), GTK_POS_LEFT);

  gtk_range_set_value(GTK_RANGE(leftVolumeSlider), 1.0);
  gtk_range_set_value(GTK_RANGE(rightVolumeSlider), 1.0);

  g_signal_connect(leftVolumeSlider, "value-changed", G_CALLBACK(leftVolumeChanged), NULL);
  g_signal_connect(rightVolumeSlider, "value-changed", G_CALLBACK(rightVolumeChanged), NULL);

  // Create wide left and wide right sliders
  GtkWidget *wideLeftLabel = gtk_label_new("Wide Left");
  GtkWidget *wideRightLabel = gtk_label_new("Wide Right");
  GtkWidget *wideLeftSlider = gtk_scale_new_with_range(GTK_ORIENTATION_VERTICAL, 0.0, 1.0, 0.01);
  GtkWidget *wideRightSlider = gtk_scale_new_with_range(GTK_ORIENTATION_VERTICAL, 0.0, 1.0, 0.01);
  gtk_range_set_inverted(GTK_RANGE(wideLeftSlider), FALSE);
  gtk_range_set_inverted(GTK_RANGE(wideRightSlider), FALSE);
  gtk_scale_set_value_pos(GTK_SCALE(wideLeftSlider), GTK_POS_LEFT);
  gtk_scale_set_value_pos(GTK_SCALE(wideRightSlider), GTK_POS_LEFT);
  gtk_range_set_value(GTK_RANGE(wideLeftSlider), wideLeftSliderValue);
  gtk_range_set_value(GTK_RANGE(wideRightSlider), wideRightSliderValue);
  g_signal_connect(wideLeftSlider, "value-changed", G_CALLBACK(wideLeftSliderValueChanged), NULL);
  g_signal_connect(wideRightSlider, "value-changed", G_CALLBACK(wideRightSliderValueChanged), NULL);

  gtk_box_pack_start(GTK_BOX(slidersHBox), leftLabel, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), leftVolumeSlider, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), rightLabel, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), rightVolumeSlider, FALSE, FALSE, 10);
  gtk_box_pack_start(GTK_BOX(slidersHBox), wideLeftLabel, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), wideLeftSlider, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), wideRightLabel, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(slidersHBox), wideRightSlider, FALSE, FALSE, 10);

  gtk_box_pack_start(GTK_BOX(hbox), slidersHBox, FALSE, FALSE, 0);

  gtk_widget_show_all(window);

  PaError err = Pa_Initialize();
  if (err != paNoError) {
    std::cerr << "PortAudio error: " << Pa_GetErrorText(err) << std::endl;
    return 1;
  }

  gtk_main();

  if (audioStream) {
    Pa_StopStream(audioStream);
    Pa_CloseStream(audioStream);
    Pa_Terminate();
  }

  if (audioFile) {
    sf_close(audioFile);
  }

  return 0;
}
