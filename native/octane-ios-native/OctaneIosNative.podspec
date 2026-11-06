Pod::Spec.new do |s|
  s.name = 'OctaneIosNative'
  s.version = '1.0.0'
  s.summary = 'Octane App - iPhone native part (OBD WiFi/TCP, dashcam)'
  s.license = { :type => 'Proprietary' }
  s.homepage = 'https://octane.ge'
  s.author = 'Octane'
  s.source = { :git => 'https://octane.ge', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  # ცოცხალი ხედი (RTSP) - iPhone-ს თავისით არ შეუძლია, VLC-ის ბიბლიოთეკა სჭირდება
  s.dependency 'MobileVLCKit', '~> 3.6.0'
  s.frameworks = 'NetworkExtension', 'Network', 'AVFoundation', 'AVKit', 'Photos'
end
